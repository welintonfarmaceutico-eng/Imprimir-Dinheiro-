# Jarvis: assistente pessoal com IA e voz

Assistente pessoal que roda no navegador do celular e do PC. Você fala, ele responde em voz alta.

## O que ele faz

| Função | Exemplo de pedido |
|---|---|
| Conversar por voz | Toque no círculo e fale. Ou ative **Escuta contínua** e diga "Jarvis, ...". Depois que ele responde, você tem 10 segundos para continuar a conversa sem repetir "Jarvis". Uma pausa de 1,5 segundo encerra a frase. |
| Pesquisar na internet | "Jarvis, qual a cotação do dólar hoje?" / "Como vai estar o tempo amanhã em BH?" |
| Lembretes | "Me lembra de pagar a conta de luz amanhã às 9h". Na hora marcada, ele avisa em voz alta e manda uma notificação. |
| Anotações | "Anota que a senha do wi-fi da loja é 1234" / "Quais são minhas notas?" |
| Controle financeiro | "Gastei 35 reais no almoço" / "Recebi 2 mil de vendas" / "Quanto gastei este mês?" |
| Avisos no WhatsApp | Os lembretes chegam no seu WhatsApp na hora marcada, mesmo com o site fechado. "Manda no meu WhatsApp a lista de compras" |
| Computador (Jarvis PC) | "Abre o Spotify no PC" / "Abre o YouTube no computador" / "Aumenta o volume do PC" |
| Google Agenda | "O que tenho amanhã?" / "Marca dentista sexta às 14h" / "Desmarca a reunião de quinta" |

Os painéis laterais mostram os lembretes, as notas e o resumo financeiro do mês, e se atualizam sozinhos.

Outros recursos:
- **Resposta em tempo real:** o texto aparece enquanto é gerado, e a voz começa na primeira frase, sem esperar a resposta inteira.
- **Botões rápidos** (+ Gasto/Ganho, + Nota, + Lembrete): salvam direto, sem usar a IA, e por isso não custam nada.
- **Ajustes (⚙):** cinco temas de cor (azul, vermelho, verde, roxo e claro), cinco formatos de núcleo animado (rede neural, galáxia, anéis, cristal e enxame), escolha da voz e da velocidade da fala, e um botão para testar a voz.
- **Núcleo animado:** partículas em 3D (`public/nucleo.js`). Ficam calmas em repouso, verdes quando ele está ouvindo, giram mais rápido quando ele pensa e pulsam a cada palavra falada.
- **Economia:** a conversa recomeça sozinha a cada dia, porque conversas curtas custam menos. Notas, gastos e lembretes continuam guardados. Cada pergunta faz no máximo 2 pesquisas na internet.

## Como rodar

Você precisa do **Node.js 22.9 ou mais novo** e de uma **chave da API da Anthropic**. Para criar a chave, acesse console.anthropic.com, vá em *API Keys* e clique em *Create Key*.

```bash
cd jarvis
npm install
cp .env.exemplo .env     # depois abra o .env e cole sua chave em ANTHROPIC_API_KEY
npm start
```

Depois abra **http://localhost:3000** no **Chrome** ou no **Edge** e permita o uso do microfone.

### Configurações (arquivo `.env`)

| Variável | Para que serve |
|---|---|
| `ANTHROPIC_API_KEY` | **Obrigatória.** Sua chave da API. |
| `JARVIS_SENHA` | Pede uma senha para usar o Jarvis. **Use sempre que ele ficar na internet**, senão qualquer pessoa gasta seus créditos. |
| `JARVIS_NOME_USUARIO` | Seu nome, para o Jarvis te chamar por ele. |
| `JARVIS_ESFORCO` | `low` (padrão, mais rápido e barato) até `high` (pensa mais). |
| `JARVIS_FUSO` | Fuso horário dos lembretes. O padrão é `America/Sao_Paulo`. |
| `PORT` | Porta do servidor. O padrão é `3000`. |
| `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` | Para ligar o Google Agenda (veja abaixo). |
| `WHATSAPP_TELEFONE` e `WHATSAPP_APIKEY` | Para receber os lembretes no WhatsApp (veja abaixo). |
| `JARVIS_RESUMO_HORA` | Hora do resumo diário no WhatsApp (0 a 23). O padrão é `7`. Use `desligado` para não receber. |

## Publicar no Cloudflare (grátis, recomendado)

O Jarvis roda no **Cloudflare Workers**: as telas, a API e os lembretes a cada minuto. Os dados ficam no banco **D1** chamado `jarvis` (já indicado em `wrangler.jsonc`).

1. No painel do Cloudflare: **Workers & Pages → Create → Import a repository**, escolha este repositório.
2. Em **Root directory** (pasta raiz) coloque `jarvis`. O comando de publicação é `npx wrangler deploy` (o padrão).
3. Depois da primeira publicação, em **Settings → Variables and Secrets**, adicione como **Secret**: `ANTHROPIC_API_KEY`, `JARVIS_SENHA` (obrigatória: sem o login do Netlify, a senha é a única proteção), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WHATSAPP_TELEFONE`, `WHATSAPP_APIKEY`; e, se quiser, `JARVIS_NOME_USUARIO`.
4. No Google Cloud, no cliente OAuth, adicione o novo endereço de retorno: `https://SEU-ENDERECO.workers.dev/api/google/retorno`.
5. Abra o novo endereço, reconecte o Google Agenda e baixe de novo o Jarvis PC (a chave do PC é nova).

Cada `merge` na `main` publica sozinho. As publicações do Cloudflare são grátis.

## Publicar no Netlify (usar no celular de qualquer lugar)

O projeto já vem pronto para o Netlify: a API roda como Netlify Function (`netlify/functions/api.mjs`) e os dados ficam no Netlify Blobs.

1. No Netlify, abra o projeto e vá em **Project configuration → Build & deploy → Link repository**. Se ainda não tiver um projeto, use **Add new project → Import an existing project**.
2. Escolha o GitHub e o repositório **Imprimir-Dinheiro-**.
3. Configure:
   - **Branch to deploy:** `main`
   - **Base directory:** `jarvis`
   - **Build command:** deixe vazio
   - **Publish directory:** `public` (já definido no `netlify.toml`)
4. Em **Project configuration → Environment variables**, crie a variável `ANTHROPIC_API_KEY` com a sua chave e marque-a como **secreta**.
5. Faça um novo deploy em **Deploys → Trigger deploy**.

Para limitar o acesso, o Netlify pode exigir login da sua equipe (*Visitor access → Team login*). Assim só você usa o Jarvis. Outra opção é definir `JARVIS_SENHA` nas variáveis de ambiente.

No Chrome do Android, use *Adicionar à tela inicial* para ele abrir como um aplicativo.

> O reconhecimento de voz funciona no Chrome, no Edge e no Chrome do Android. No iPhone (Safari) ele pode ser limitado. Nesse caso, digite; a resposta em voz funciona normalmente.

## Ligar o Google Agenda

A configuração é feita uma vez só, no Google Cloud, e leva uns 10 minutos.

1. Acesse **console.cloud.google.com** e crie um projeto (por exemplo, "Jarvis").
2. Em **APIs e serviços → Biblioteca**, procure **Google Calendar API** e clique em **Ativar**.
3. Em **APIs e serviços → Tela de permissão OAuth** (ou **Google Auth Platform**):
   - Tipo de usuário: **Externo**. Preencha o nome do app ("Jarvis") e o seu e-mail.
   - Em **Público-alvo**, clique em **Publicar app** para colocá-lo **Em produção**. Em modo "Teste", o Google desconecta o Jarvis a cada 7 dias.
4. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - **URIs de redirecionamento autorizados**: `https://SEU-SITE.netlify.app/api/google/retorno`. Para usar no computador, adicione também `http://localhost:3000/api/google/retorno`.
5. Copie o **ID do cliente** e a **Chave secreta do cliente** e crie as variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Netlify (marque a chave secreta como **secret**) ou no `.env`. No Netlify, faça um novo deploy depois.
6. Abra o Jarvis e toque em **Conectar Google Agenda**. Na tela "O Google não verificou este app", toque em **Avançado → Acessar Jarvis**. É normal: o app é seu e só você usa.

O Jarvis só pede acesso aos **eventos** da agenda. Para desconectar, remova o acesso em **myaccount.google.com/permissions**.

## Avisos no WhatsApp

Os avisos usam o **CallMeBot**, um serviço gratuito que manda mensagens para o **seu próprio** WhatsApp. Ele não é oficial da Meta.

1. Abra a página oficial do CallMeBot para WhatsApp (callmebot.com, seção "WhatsApp API") e veja qual é o número atual do robô.
2. Salve esse número nos contatos do celular e mande para ele, pelo WhatsApp, a mensagem que a página indicar (algo como "I allow callmebot to send me messages").
3. Em alguns segundos você recebe a sua **apikey**.
4. No Netlify, crie as variáveis:
   - `WHATSAPP_TELEFONE`: seu número **exatamente como aparece na mensagem de ativação do robô**, com DDI e DDD, ex.: `+553199998888`. Atenção: muitos números do Brasil estão registrados no WhatsApp **sem o 9 extra**. Se o número tiver um 9 a mais ou a menos, o CallMeBot responde "APIKey is invalid".
   - `WHATSAPP_APIKEY`: a apikey recebida (marque como **secret**)
5. Faça um novo deploy e toque em **Mandar resumo do dia no WhatsApp** na tela do Jarvis.

A cada minuto, a função agendada `lembretes-whatsapp` confere os lembretes que acabaram de vencer e manda cada um uma vez só. Lembretes vencidos há mais de 30 minutos não são enviados.

### Resumo diário

Todo dia, às 7h (ou na hora de `JARVIS_RESUMO_HORA`), chega no WhatsApp um resumo com os compromissos do Google Agenda, os lembretes do dia e as finanças do mês. O resumo é montado sem a IA, então **não gasta crédito da Anthropic**. Se o Google Agenda estiver desconectado, o resumo avisa para reconectar.

**Previsão do tempo:** diga ao Jarvis "minha cidade é Montes Claros, MG" e a previsão do dia entra no resumo (serviço gratuito Open-Meteo, sem chave).

**Relatório do mês:** no dia 1º, junto com o resumo, chega o relatório do mês anterior: entradas, saídas, saldo, maiores gastos e a comparação com o mês de antes.

### Foto de nota fiscal

Toque no 📷 ao lado do "Enviar" e tire a foto da nota, cupom ou recibo. O Jarvis lê o valor total, a loja, a data e escolhe a categoria, e anota o gasto sozinho. Se ler errado, toque em "Desfazer". Cada foto gasta alguns centavos de crédito da Anthropic (a foto é reduzida no aparelho antes de ser enviada).

### Lembretes que se repetem

"Me lembra de tomar o remédio todo dia às 8h", "de segunda a sexta às 7h", "toda segunda" ou "todo dia 10". Cinco minutos depois de cada aviso, o lembrete passa para a próxima vez. Para parar, peça para concluir o lembrete. No botão "+ Lembrete" também tem a opção "Repetir".

## Telegram (e Android Auto)

Converse com o Jarvis pelo Telegram, de qualquer lugar. No carro, o Android Auto lê as respostas em voz alta e você responde ditando.

1. No Telegram, fale com o **@BotFather**, mande `/newbot`, escolha um nome e um usuário terminado em `bot`. Ele entrega um **token**.
2. No Cloudflare, adicione o segredo `TELEGRAM_BOT_TOKEN` com esse token.
3. No Jarvis: **⚙ Ajustes → Telegram → Conectar Telegram → Abrir o Telegram** e toque em **Começar**.

No carro, o Google não encontra robôs pelo nome ("mandar mensagem para Jarvis" não funciona). Por isso o Jarvis também manda no Telegram os lembretes, o resumo das 7h e o relatório do mês: no Android Auto, diga "responder" a uma mensagem dele (ou "Ok Google, ler minhas mensagens") e fale o pedido. O botão "Mandar resumo do dia" também manda no Telegram, para ter sempre uma mensagem dele à mão.

Só o seu chat fica ligado (código de uso único, válido por 15 minutos); mensagens de outras pessoas são ignoradas. Foto de nota fiscal mandada no Telegram também vira gasto. A conversa do Telegram recomeça a cada dia, para gastar menos.

## Jarvis PC (abrir programas, sites e volume no Windows)

Um programa pequeno em PowerShell, que já vem no Windows, recebe as ordens do Jarvis e as executa no computador.

1. No Jarvis, abra **⚙ Ajustes → Computador** e toque em **Baixar programa do PC**. O arquivo `jarvis-pc.ps1` já vem com a sua chave secreta.
2. No computador, aperte **Windows + R**, digite `powershell` e aperte **Enter**.
3. Na janela do PowerShell, rode o comando abaixo, trocando o caminho pelo do arquivo baixado. Também dá para digitar o começo do comando e arrastar o arquivo para dentro da janela:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File (Get-ChildItem "$env:USERPROFILE\Downloads\jarvis-pc*.ps1" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
   ```
4. Aparece a mensagem "Jarvis PC instalado e conectado!". A partir daí, ele inicia sozinho junto com o Windows.

O botão direito → "Executar com o PowerShell" pode não funcionar: em alguns PCs a janela fecha antes de instalar.

Como funciona:
- O PC fala **direto com o Jarvis**: fica perguntando por ordens em `/api/pc/esperar` (cada pergunta aguarda até 25 segundos) e devolve o resultado em `/api/pc/resposta`. São umas 3.500 consultas por dia, bem dentro do plano grátis do Cloudflare.
- Toda ordem e toda resposta são **assinadas com HMAC-SHA256**, usando a chave secreta. O programa ignora ordens falsas e ordens com mais de 5 minutos.
- O programa só faz três coisas: **abrir programa** (atalhos do menu Iniciar e da Área de Trabalho, ou programas do Windows), **abrir site** (só endereços http ou https) e **volume**. Nunca roda comandos livres.
- O programa fica instalado em `%APPDATA%\JarvisPC`, e o registro de atividades fica em `registro.txt`. O atalho para iniciar com o Windows fica na pasta Inicializar.
- Para desligar: **⚙ Ajustes → Desconectar o PC**. Isso apaga a chave. Para remover o programa, apague o atalho "Jarvis PC" da pasta Inicializar (`shell:startup`) e a pasta `%APPDATA%\JarvisPC`.

## Custos

O Jarvis usa o modelo Claude Opus 5.5 (US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída). Uma pergunta simples custa frações de centavo. As pesquisas na internet têm uma cobrança extra por busca. Para economizar, mantenha `JARVIS_ESFORCO=low` e use **Nova conversa** quando mudar de assunto.

Para não precisar ficar de olho no saldo, em **console.anthropic.com → Settings**:
- **Billing → Auto-reload**: recarrega sozinho quando o saldo fica baixo.
- **Limits**: define um teto de gasto por mês.
- **Usage**: mostra quanto foi gasto por dia.

Se os créditos acabarem ou o teto do mês for atingido, o Jarvis avisa na tela e, se o WhatsApp estiver configurado, manda um aviso por lá (no máximo uma vez por dia).

Se o modelo recusar um pedido por engano, o próprio servidor da Anthropic tenta de novo automaticamente com outro modelo (opção `fallbacks: "default"` em `src/cerebro.js`).

## Estrutura

```
jarvis/
├── server.js                  # servidor local (no seu computador)
├── netlify/functions/api.mjs  # a mesma API, rodando no Netlify
├── src/rotas.js               # rotas da API (usadas pelos dois)
├── src/cerebro.js             # conversa com o Claude e executa as ferramentas
├── src/ferramentas.js         # notas, lembretes e finanças (definições das ferramentas)
├── src/db.js                  # regras dos dados
├── src/armazem.js             # onde salva: arquivo local ou Netlify Blobs
├── src/google.js              # conexão e acesso ao Google Agenda
├── src/whatsapp.js            # avisos no WhatsApp (CallMeBot)
├── src/computador.js          # ponte com o Jarvis PC (fila no banco + assinatura HMAC)
├── src/jarvis-pc-modelo.js    # o programa do Windows (PowerShell), preenchido no download
├── netlify/functions/lembretes-whatsapp.mjs  # confere os lembretes a cada minuto
├── public/                    # interface (HTML, CSS e JS com voz)
└── test/                      # testes: npm test
```

No computador, tudo fica salvo em `dados/jarvis.json`. No Netlify, fica no Netlify Blobs (menu **Data & Storage → Blobs**).
