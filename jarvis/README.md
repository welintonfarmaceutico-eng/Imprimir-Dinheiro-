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

Os painéis laterais mostram os lembretes, as notas e o resumo financeiro do mês, e se atualizam sozinhos.

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

## Custos

O Jarvis usa o modelo Claude Opus 5.5 (US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída). Uma pergunta simples custa frações de centavo. As pesquisas na internet têm uma cobrança extra por busca. Para economizar, mantenha `JARVIS_ESFORCO=low` e use **Nova conversa** quando mudar de assunto.

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
├── public/                    # interface (HTML, CSS e JS com voz)
└── test/                      # testes: npm test
```

No computador, tudo fica salvo em `dados/jarvis.json`. No Netlify, fica no Netlify Blobs (menu **Data & Storage → Blobs**).
