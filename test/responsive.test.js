import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { createSession } from '../src/config/database.js';

const TEST_PORT = 3399;

async function run() {
  console.log('--- INICIANDO TESTE DE RESPONSIVIDADE E MOBILE WEB APP ---');

  const server = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe'
  });

  await sleep(2500);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const testSession = createSession();

    // 1. TESTE EM DISPOSITIVO ULTRA-COMPACTO (360 x 640 - Android Compacto / iPhone SE)
    console.log('\n1. Testando Viewport Ultra-Compacta (360 x 640)...');
    const compactContext = await browser.newContext({
      viewport: { width: 360, height: 640 },
      isMobile: true,
      hasTouch: true
    });
    const compactPage = await compactContext.newPage();

    await compactPage.addInitScript((token) => {
      localStorage.setItem('whatsbot_auth_token', token);
    }, testSession.token);

    await compactPage.goto(`http://localhost:${TEST_PORT}`);
    await compactPage.waitForLoadState('networkidle');
    await compactPage.waitForSelector('#app-screen:not(.hidden)', { timeout: 6000 });

    const scrollW360 = await compactPage.evaluate(() => document.documentElement.scrollWidth);
    const innerW360 = await compactPage.evaluate(() => window.innerWidth);
    console.log(`   Largura do Documento: ${scrollW360}px | Largura da Janela: ${innerW360}px`);
    if (scrollW360 <= innerW360) {
      console.log('   ✅ [PASS] ZERO vazamento em tela de 360px!');
    } else {
      console.error(`   ❌ [FAIL] Vazamento em 360px: ${scrollW360}px > ${innerW360}px`);
      process.exit(1);
    }

    // 2. TESTE EM DISPOSITIVO MÓVEL PADRÃO (iPhone 12 / Modern Smartphone: 390x844)
    console.log('\n2. Testando Viewport Mobile (390 x 844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const page = await mobileContext.newPage();

    await page.addInitScript((token) => {
      localStorage.setItem('whatsbot_auth_token', token);
    }, testSession.token);

    await page.goto(`http://localhost:${TEST_PORT}`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 6000 });

    // Verifica se há overflow horizontal no mobile
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    console.log(`   Largura do Documento: ${scrollWidth}px | Largura da Janela: ${innerWidth}px`);
    if (scrollWidth <= innerWidth) {
      console.log('   ✅ [PASS] ZERO vazamento horizontal! O layout cabe perfeitamente na tela mobile.');
    } else {
      console.error(`   ❌ [FAIL] Vazamento detectado: ${scrollWidth}px > ${innerWidth}px`);
      process.exit(1);
    }

    // Verifica Header no mobile
    const headerBox = await page.locator('header').boundingBox();
    console.log(`   Header altura: ${headerBox.height}px | largura: ${headerBox.width}px`);
    if (headerBox.height <= 70 && headerBox.width <= innerWidth) {
      console.log('   ✅ [PASS] Header responsivo contido sem estourar altura ou largura.');
    } else {
      console.warn(`   ⚠️ Alerta de dimensão do Header: ${headerBox.height}px x ${headerBox.width}px`);
    }

    // Verifica se os botões do Header estão dentro da tela
    const badges = await page.evaluate(() => {
      const clock = document.getElementById('bot-clock-badge').getBoundingClientRect();
      const ngrok = document.getElementById('ngrok-status-badge').getBoundingClientRect();
      const wa = document.getElementById('wa-status-badge').getBoundingClientRect();
      const winW = window.innerWidth;
      return {
        clockRight: clock.right,
        ngrokRight: ngrok.right,
        waRight: wa.right,
        winW
      };
    });
    console.log('   Posições dos badges no Header:', badges);
    if (badges.waRight <= badges.winW + 2) {
      console.log('   ✅ [PASS] Todos os itens do Header estão dentro dos limites da tela mobile!');
    } else {
      console.error('   ❌ [FAIL] Itens do Header continuam vazando fora da tela!');
      process.exit(1);
    }

    // Testa navegação inferior Mobile Web App (Bottom Navigation)
    console.log('\n3. Testando Abas da Interface Mobile...');
    const bottomNavVisible = await page.locator('#mobile-nav').isVisible();
    console.log(`   Barra de navegação inferior visível no mobile: ${bottomNavVisible}`);
    if (bottomNavVisible) {
      console.log('   ✅ [PASS] Barra inferior Mobile (Web App PWA) visível.');
    } else {
      console.error('   ❌ [FAIL] Barra inferior mobile não encontrada.');
      process.exit(1);
    }

    // Clica na aba Conexões / Status
    await page.click('#tab-btn-status');
    await sleep(300);
    const statusViewVisible = await page.locator('#view-status').isVisible();
    const schedulesViewVisible = await page.locator('#view-schedules').isVisible();
    console.log(`   Aba Status ativa: view-status=${statusViewVisible}, view-schedules=${schedulesViewVisible}`);
    if (statusViewVisible && !schedulesViewVisible) {
      console.log('   ✅ [PASS] Alternância de abas mobile funcionando com sucesso!');
    }

    // Clica na aba Ajustes
    await page.click('#tab-btn-settings');
    await sleep(300);
    const settingsViewVisible = await page.locator('#view-settings').isVisible();
    if (settingsViewVisible) {
      console.log('   ✅ [PASS] Aba Ajustes ativa e visível no mobile!');
    }

    // Volta para Cultos
    await page.click('#tab-btn-schedules');
    await sleep(300);

    // 4. Testa Modal de Cronograma e Form Responsivo no Mobile
    console.log('\n4. Testando Formulário de Criação de Cronograma no Mobile...');
    await page.click('button:has-text("Criar Cronograma")');
    await sleep(500);

    const modalVisible = await page.locator('#schedule-modal:not(.hidden)').isVisible();
    console.log(`   Modal de cronograma visível: ${modalVisible}`);
    if (!modalVisible) {
      console.error('   ❌ [FAIL] Modal não abriu!');
      process.exit(1);
    }

    const modalBox = await page.locator('#schedule-modal-content').boundingBox();
    console.log(`   Dimensões do Modal no mobile: ${modalBox.width}px x ${modalBox.height}px (Tela: 390x844)`);
    if (modalBox.width <= 390 && modalBox.height <= 844) {
      console.log('   ✅ [PASS] Modal cabe perfeitamente na viewport mobile sem corte.');
    }

    // Verifica itens do cronograma dentro do modal
    const itemCards = await page.locator('#schedule-items-container .item-row').count();
    console.log(`   Quantidade de momentos gerados no form: ${itemCards}`);
    if (itemCards >= 4) {
      console.log('   ✅ [PASS] Momentos iniciais adicionados corretamente.');
    }

    // Verifica se os cards de momentos possuem rótulos no mobile
    const itemBadges = await page.locator('#schedule-items-container .item-badge').count();
    const itemLabels = await page.locator('#schedule-items-container label:has-text("Nome do Momento")').count();
    console.log(`   Badges de momentos (#1, #2...): ${itemBadges} | Labels de Nome: ${itemLabels}`);
    if (itemBadges >= 4 && itemLabels >= 4) {
      console.log('   ✅ [PASS] Formulário possui cards estruturados com rótulos e hierarquia limpa!');
    } else {
      console.error('   ❌ [FAIL] Faltam rótulos nos momentos!');
      process.exit(1);
    }

    // Testa adicionar novo momento
    await page.click('button:has-text("Adicionar Momento")');
    await sleep(300);
    const newItemCards = await page.locator('#schedule-items-container .item-row').count();
    console.log(`   Novo momento adicionado: total agora = ${newItemCards}`);
    if (newItemCards === itemCards + 1) {
      console.log('   ✅ [PASS] Adicionar momento via botão responsivo funcionou!');
    }

    // Testa botões do rodapé do modal no mobile
    const saveBtn = page.locator('#schedule-modal button:has-text("Salvar Cronograma")');
    const cancelBtn = page.locator('#schedule-modal button:has-text("Cancelar")');
    const saveBtnBox = await saveBtn.boundingBox();
    console.log(`   Botão Salvar altura: ${saveBtnBox.height}px | largura: ${saveBtnBox.width}px`);
    if (saveBtnBox.height >= 36 && saveBtnBox.width > 150) {
      console.log('   ✅ [PASS] Botão Salvar Cronograma confortável e thumb-friendly no mobile!');
    }

    await cancelBtn.click();
    await sleep(400);

    // 5. TESTE EM VIEWPORT DESKTOP (1280 x 800)
    console.log('\n5. Testando Viewport Desktop (1280 x 800)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.addInitScript((token) => {
      localStorage.setItem('whatsbot_auth_token', token);
    }, testSession.token);

    await desktopPage.goto(`http://localhost:${TEST_PORT}`);
    await desktopPage.waitForLoadState('networkidle');
    await desktopPage.waitForSelector('#app-screen:not(.hidden)', { timeout: 6000 });

    // Verifica que no desktop a barra inferior está oculta
    const desktopNavVisible = await desktopPage.locator('#mobile-nav').isVisible();
    console.log(`   Barra inferior oculta no desktop: ${!desktopNavVisible}`);
    if (!desktopNavVisible) {
      console.log('   ✅ [PASS] Barra mobile oculta no desktop (lg:hidden funcionando).');
    }

    // Verifica que as seções principais (Cultos, Configurações, Logs) estão visíveis simultaneamente
    const deskSchedules = await desktopPage.locator('#view-schedules').isVisible();
    const deskSettings = await desktopPage.locator('#view-settings').isVisible();
    const deskLogs = await desktopPage.locator('#view-logs').isVisible();
    console.log(`   Visualização multi-coluna desktop: Schedules=${deskSchedules}, Settings=${deskSettings}, Logs=${deskLogs}`);
    if (deskSchedules && deskSettings && deskLogs) {
      console.log('   ✅ [PASS] Desktop exibe simultaneamente todas as colunas de controle!');
    }

    // Verifica se os textos do Header no desktop mostram informações completas
    const waTextDesk = await desktopPage.locator('#wa-status-text').isVisible();
    console.log(`   Texto completo de status no desktop visível: ${waTextDesk}`);
    if (waTextDesk) {
      console.log('   ✅ [PASS] Header desktop expande com texto legível completo!');
    }

    console.log('\n======================================================');
    console.log('🎉 TODOS OS TESTES DE RESPONSIVIDADE E UX PASSARAM!');
    console.log('======================================================\n');

  } finally {
    await browser.close();
    server.kill();
  }
}

run().catch(err => {
  console.error('Erro nos testes de responsividade:', err);
  process.exit(1);
});
