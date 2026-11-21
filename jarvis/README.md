# Jarvis: assistente pessoal com IA e voz

Assistente pessoal que roda no navegador do celular e do PC. Você fala, ele responde em voz alta.

## O que ele faz

| Função | Exemplo de pedido |
|---|---|
| Conversar por voz | Toque no círculo e fale. Ou ative **Escuta contínua** e diga "Jarvis, ..." |
| Pesquisar na internet | "Jarvis, qual a cotação do dólar hoje?" / "Como vai estar o tempo amanhã em BH?" |
| Lembretes | "Me lembra de pagar a conta de luz amanhã às 9h". Na hora marcada, ele avisa em voz alta e manda uma notificação. |
| Anotações | "Anota que a senha do wi-fi da loja é 1234" / "Quais são minhas notas?" |
| Controle financeiro | "Gastei 35 reais no almoço" / "Recebi 2 mil de vendas" / "Quanto gastei este mês?" |
| Avisos no WhatsApp | Os lembretes chegam no seu WhatsApp na hora marcada, mesmo com o site fechado. "Manda no meu WhatsApp a lista de compras" |
| Google Agenda | "O que tenho amanhã?" / "Marca dentista sexta às 14h" / "Desmarca a reunião de quinta" |

Os painéis laterais mostram os lembretes, as notas e o resumo financeiro do mês, e se atualizam sozinhos.

Outros recursos:
- **Resposta em tempo real:** o texto aparece enquanto é gerado, e a voz começa na primeira frase, sem esperar a resposta inteira.
- **Botões rápidos** (+ Gasto/Ganho, + Nota, + Lembrete): salvam direto, sem usar a IA, e por isso não custam nada.
- **Ajustes (⚙):** cinco temas de cor (azul, vermelho, verde, roxo e claro), escolha da voz e da velocidade da fala, e um botão para testar a voz. O círculo pulsa a cada palavra falada ou ouvida.
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
5. Faça um novo deploy e toque em **Testar aviso no WhatsApp** na tela do Jarvis.

A cada minuto, a função agendada `lembretes-whatsapp` confere os lembretes que acabaram de vencer e manda cada um uma vez só. Lembretes vencidos há mais de 30 minutos não são enviados.

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
├── netlify/functions/lembretes-whatsapp.mjs  # confere os lembretes a cada minuto
├── public/                    # interface (HTML, CSS e JS com voz)
└── test/                      # testes: npm test
```

No computador, tudo fica salvo em `dados/jarvis.json`. No Netlify, fica no Netlify Blobs (menu **Data & Storage → Blobs**).
