# 🚀 Guia de Instalação e Deploy em VPS - WhatsBot Sonoplasta

Este guia contém o passo a passo completo para instalar, configurar e manter o **WhatsBot Sonoplasta** rodando 24 horas por dia, 7 dias por semana em uma VPS (Virtual Private Server) Linux (Ubuntu 22.04 LTS ou Ubuntu 24.04 LTS / Debian 12).

---

## 📋 Sumário
1. [Requisitos Mínimos da VPS](#1-requisitos-mínimos-da-vps)
2. [Passo 1: Preparação Inicial do Servidor](#passo-1-preparação-inicial-do-servidor)
3. [Passo 2: Configuração de Memória Swap (Essencial)](#passo-2-configuração-de-memória-swap-essencial)
4. [Passo 3: Instalação do Node.js 22 LTS](#passo-3-instalação-do-nodejs-22-lts)
5. [Passo 4: Download e Instalação da Aplicação](#passo-4-download-e-instalação-da-aplicação)
6. [Passo 5: Instalação das Dependências do Playwright](#passo-5-instalação-das-dependências-do-playwright)
7. [Passo 6: Configuração das Variáveis de Ambiente (.env)](#passo-6-configuração-das-variáveis-de-ambiente-env)
8. [Passo 7: Configuração do PM2 (Execução Contínua em Segundo Plano)](#passo-7-configuração-do-pm2-execução-contínua-em-segundo-plano)
9. [Passo 8: Configuração do Nginx e SSL Grátis (HTTPS)](#passo-8-configuração-do-nginx-e-ssl-grátis-https)
10. [Passo 9: Configuração do Firewall (UFW)](#passo-9-configuração-do-firewall-ufw)
11. [Passo 10: Conexão do WhatsApp via QR Code](#passo-10-conexão-do-whatsapp-via-qr-code)
12. [Rotina de Atualizações e Backups](#rotina-de-atualizações-e-backups)
13. [Solução de Problemas Comuns (Troubleshooting)](#solução-de-problemas-comuns-troubleshooting)

---

## 1. Requisitos Mínimos da VPS

- **Sistema Operacional:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS ou Debian 12 (64 bits).
- **Processador:** 1 vCPU ou superior.
- **Memória RAM:** Mínimo de 1 GB (com Swap de 2 GB obrigatória) ou recomendado 2 GB RAM.
- **Armazenamento:** 15 GB SSD ou superior.
- **Node.js:** Versão **22.5.0 ou superior** (o projeto utiliza `node:sqlite` nativo da engine do Node 22).

---

## Passo 1: Preparação Inicial do Servidor

Acesse sua VPS via SSH:
```bash
ssh root@SEU_IP_DA_VPS
```

Atualize todos os pacotes do sistema:
```bash
sudo apt update && sudo apt upgrade -y
```

Instale os pacotes e utilitários essenciais:
```bash
sudo apt install -y curl wget git build-essential ufw software-properties-common
```

Configure o fuso horário da máquina para o horário de Brasília (ou da sua região):
```bash
sudo timedatectl set-timezone America/Sao_Paulo
# Confirme a data e hora:
timedatectl
```

---

## Passo 2: Configuração de Memória Swap (Essencial)

O **Playwright/Chromium** (usado para raspar títulos do YouTube) necessita de picos de memória. Em VPS de 1GB ou 2GB de RAM, a falta de swap causará travamentos por falta de memória (OOM Killer).

Crie uma partição Swap de 2 GB:
```bash
# Verifica se já existe swap ativo
free -h

# Se não houver swap suficiente, crie um arquivo de 2GB:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Torne a swap permanente após reinicializações:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Confirme que a swap está ativa:
free -h
```

---

## Passo 3: Instalação do Node.js 22 LTS

> ⚠️ **Atenção:** É obrigatório utilizar o **Node.js v22 ou superior**, pois a aplicação usa o módulo nativo `node:sqlite` (`DatabaseSync`).

Adicione o repositório oficial do NodeSource e instale o Node.js 22:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verifique as versões instaladas:
node -v   # Deve exibir v22.x.x
npm -v    # Deve exibir v10.x.x
```

Instale o gerenciador de processos **PM2** globalmente:
```bash
sudo npm install -g pm2
```

---

## Passo 4: Download e Instalação da Aplicação

Recomendamos criar uma pasta de trabalho organizada (ex: `/var/www` ou na pasta do seu usuário):

```bash
# Crie a pasta do projeto e acerte as permissões
sudo mkdir -p /var/www/whatsbot-soplasta
sudo chown -R $USER:$USER /var/www/whatsbot-soplasta
cd /var/www/whatsbot-soplasta

# Clone o seu repositório:
git clone https://github.com/SEU_USUARIO/whatsbot-soplasta.git .

# Instale as dependências do Node.js:
npm install --omit=dev
```
*(Nota: se preferir instalar tudo incluindo dependências de desenvolvimento, use apenas `npm install`)*.

---

## Passo 5: Instalação das Dependências do Playwright

O Playwright precisa do binário do Chromium e das bibliotecas de sistema operacional C++/X11 do Linux:

```bash
# Instala o navegador Chromium
npx playwright install chromium

# Instala as bibliotecas do sistema Linux exigidas pelo Chromium
sudo npx playwright install-deps chromium
```

> 💡 **Nota:** O comando `install-deps` instalará pacotes como `libasound2`, `libnss3`, `libxss1`, etc., que garantem que o navegador headless funcione sem falhas no ambiente Linux sem interface gráfica.

---

## Passo 6: Configuração das Variáveis de Ambiente (.env)

Copie o arquivo de exemplo para criar seu `.env` oficial:
```bash
cp .env.example .env
nano .env
```

Edite as seguintes variáveis:
```env
# Porta local do servidor Express
PORT=3000

# Chave de API do Google Gemini (https://aistudio.google.com/)
GEMINI_API_KEY=sua_chave_gemini_aqui

# Número do Sonoplasta com DDI e DDD (ex: 5511999998888)
SONOPLASTA_PHONE=5511999998888

# Nome do Bot para mensagens
BOT_NAME=WhatsBot Sonoplasta

# Fuso horário para os agendamentos e cronômetro
TIMEZONE=America/Sao_Paulo

# Horário padrão de envio dos lembretes da véspera (HH:MM)
REMINDER_TIME=09:00

# Se você for usar Nginx / Domínio próprio na VPS, DESATIVE o Ngrok:
NGROK_ENABLED=false
# Caso queira usar Ngrok mesmo na VPS, mantenha true e insira seu token:
# NGROK_AUTHTOKEN=seu_token_ngrok
# NGROK_DOMAIN=seu_dominio_ngrok

# Credenciais de acesso ao Painel Web (ALTERE A SENHA PADRÃO!)
ADMIN_USER=admin
ADMIN_PASSWORD=SuaSenhaForteAqui123!
```

Salve e saia do nano com `Ctrl + O`, `Enter` e `Ctrl + X`.

---

## Passo 7: Configuração do PM2 (Execução Contínua em Segundo Plano)

O **PM2** garante que a aplicação continue rodando mesmo se a conexão SSH for fechada, além de reiniciar o bot automaticamente em caso de falhas ou reinicialização da VPS.

Inicie a aplicação com o PM2:
```bash
pm2 start src/server.js --name "whatsbot"
```

Configure o PM2 para inicializar automaticamente com o boot do servidor:
```bash
pm2 startup
```
*(O comando acima exibirá uma linha de comando com `sudo env PATH=...`. Copie e execute essa linha no terminal)*.

Grave a lista de processos atual para persistência:
```bash
pm2 save
```

### Comandos Úteis do PM2:
- **Ver status:** `pm2 status`
- **Acompanhar logs em tempo real:** `pm2 logs whatsbot`
- **Reiniciar o bot:** `pm2 restart whatsbot`
- **Parar o bot:** `pm2 stop whatsbot`
- **Monitor de CPU e Memória:** `pm2 monit`

---

## Passo 8: Configuração do Nginx e SSL Grátis (HTTPS)

Para acessar o Painel Web com segurança pelo seu domínio ou subdomínio (ex: `bot.suaigreja.com.br`) usando HTTPS:

### 1. Instale o Nginx e o Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Aponte o DNS:
No painel do seu domínio (Cloudflare, Registro.br, Hostinger, etc.), crie um apontamento do tipo **A**:
- **Nome/Host:** `bot` (ou `@`)
- **Tipo:** `A`
- **Conteúdo/Destino:** `SEU_IP_DA_VPS`

### 3. Crie a configuração do Nginx:
```bash
sudo nano /etc/nginx/sites-available/whatsbot
```

Cole o seguinte conteúdo (substitua `bot.suaigreja.com.br` pelo seu domínio real):
```nginx
server {
    listen 80;
    server_name bot.suaigreja.com.br;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # Suporte a WebSockets e cabeçalhos de proxy
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ative o site e teste a configuração:
```bash
sudo ln -s /etc/nginx/sites-available/whatsbot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Obtenha o Certificado SSL Gratuito (HTTPS):
```bash
sudo certbot --nginx -d bot.suaigreja.com.br
```
Siga as instruções na tela (informe seu e-mail e aceite os termos). O Certbot configurará a renovação automática e o redirecionamento HTTP para HTTPS sozinho.

---

## Passo 9: Configuração do Firewall (UFW)

Proteja sua VPS liberando apenas as portas necessárias:

```bash
# Libera SSH (não bloqueie sua própria conexão!)
sudo ufw allow OpenSSH

# Libera tráfego Web HTTP e HTTPS
sudo ufw allow 'Nginx Full'

# (Opcional) Se você NÃO for usar Nginx e quiser acessar direto pelo IP na porta 3000:
# sudo ufw allow 3000/tcp

# Ativa o firewall
sudo ufw enable
sudo ufw status
```

---

## Passo 10: Conexão do WhatsApp via QR Code

Agora que a aplicação está rodando:

### Opção A: Pelo Painel Web (Recomendado)
1. Acesse no seu navegador: `https://bot.suaigreja.com.br` (ou `http://SEU_IP_DA_VPS:3000`).
2. Faça login com o usuário e senha definidos no `.env` (`ADMIN_USER` e `ADMIN_PASSWORD`).
3. Clique no botão de status do **WhatsApp** no canto superior direito.
4. Abra o WhatsApp no celular: **Aparelhos Conectados** > **Conectar um aparelho**.
5. Aponte a câmera para o QR Code exibido no painel.

### Opção B: Pelo Terminal via Logs do PM2
Você também pode visualizar o QR Code em formato texto diretamente no terminal:
```bash
pm2 logs whatsbot --lines 100
```
O QR Code impresso no terminal pode ser lido com a câmera do WhatsApp.

Assim que conectado, o status no painel mudará para **Conectado**!

---

## Rotina de Atualizações e Backups

### Como Atualizar a Aplicação com Novos Recursos
Quando houver atualizações no repositório GitHub:
```bash
cd /var/www/whatsbot-soplasta

# Baixa as alterações mais recentes
git pull origin main

# Instala novas dependências se houver
npm install --omit=dev

# Atualiza dependências do Playwright se necessário
npx playwright install chromium

# Reinicia a aplicação sem downtime
pm2 restart whatsbot
```

### Arquivos Críticos para Backup
Se você precisar migrar de VPS ou fazer backup regular, guarde com segurança:
1. `data/whatsbot.db` — Banco de dados SQLite com todos os cronogramas, cultos e configurações.
2. `baileys_auth_info/` — Chaves de sessão do WhatsApp (evita ter que escanear o QR Code de novo).
3. `.env` — Credenciais e chaves de API.

Exemplo de comando para compactar o backup:
```bash
tar -czvf backup-whatsbot-$(date +%F).tar.gz /var/www/whatsbot-soplasta/data /var/www/whatsbot-soplasta/baileys_auth_info /var/www/whatsbot-soplasta/.env
```

---

## Solução de Problemas Comuns (Troubleshooting)

### 1. Erro `Cannot find module 'node:sqlite'` ou falha ao iniciar o Node
- **Causa:** Sua versão do Node.js é anterior à 22.5.0.
- **Solução:** Execute `node -v`. Se for Node 18 ou 20, atualize para o Node 22 seguindo o [Passo 3](#passo-3-instalação-do-nodejs-22-lts).

### 2. Erro no Playwright ao extrair título do YouTube (`browserType.launch: Host system is missing dependencies`)
- **Causa:** O Linux não possui as bibliotecas gráficas compartilhadas necessárias para o Chromium headless.
- **Solução:** Execute:
  ```bash
  sudo npx playwright install-deps chromium
  pm2 restart whatsbot
  ```

### 3. A VPS trava ou o processo é finalizado com `Killed` (Out of Memory)
- **Causa:** Falta de memória RAM quando o Chromium do Playwright é acionado.
- **Solução:** Configure a partição Swap de 2 GB descrita no [Passo 2](#passo-2-configuração-de-memória-swap-essencial).

### 4. O WhatsApp desconectou sozinho (`Logged out`)
- **Causa:** A sessão expirou ou foi desconectada pelo aparelho celular.
- **Solução:** 
  1. Pare o processo: `pm2 stop whatsbot`
  2. Limpe a pasta de autenticação: `rm -rf /var/www/whatsbot-soplasta/baileys_auth_info/*`
  3. Inicie o processo: `pm2 start whatsbot`
  4. Abra o painel web ou os logs do PM2 e escaneie o novo QR Code.

### 5. Os lembretes são enviados em horários errados
- **Causa:** O fuso horário da VPS ou a variável `TIMEZONE` no `.env` não estão sincronizados.
- **Solução:** Garanta que o sistema operacional esteja em `America/Sao_Paulo` (`timedatectl set-timezone America/Sao_Paulo`) e que no `.env` conste `TIMEZONE=America/Sao_Paulo`.
