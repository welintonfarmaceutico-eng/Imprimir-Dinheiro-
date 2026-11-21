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
| `TZ` | Fuso horário dos lembretes. O padrão é `America/Sao_Paulo`. |
| `PORT` | Porta do servidor. O padrão é `3000`. |

## Usar no celular

- **Na mesma rede Wi-Fi:** o reconhecimento de voz exige HTTPS, então o mais fácil é publicar o Jarvis na internet (veja abaixo).
- **Publicado na internet:** você pode hospedar no Render, no Railway ou em uma VPS. Defina as variáveis do `.env` no painel do serviço e use `npm start` como comando de início. Nesses serviços o arquivo `dados/` pode ser apagado a cada deploy; para não perder os dados, use um disco persistente e aponte `JARVIS_DADOS` para ele.
- No Chrome do Android, use *Adicionar à tela inicial* para ele abrir como um aplicativo.

> O reconhecimento de voz funciona no Chrome, no Edge e no Chrome do Android. No iPhone (Safari) ele pode ser limitado. Nesse caso, digite; a resposta em voz funciona normalmente.

## Custos

O Jarvis usa o modelo Claude Opus 5.5 (US$ 4 por milhão de tokens de entrada e US$ 20 por milhão de saída). Uma pergunta simples custa frações de centavo. As pesquisas na internet têm uma cobrança extra por busca. Para economizar, mantenha `JARVIS_ESFORCO=low` e use **Nova conversa** quando mudar de assunto.

Se o modelo recusar um pedido por engano, o próprio servidor da Anthropic tenta de novo automaticamente com outro modelo (opção `fallbacks: "default"` em `src/cerebro.js`).

## Estrutura

```
jarvis/
├── server.js            # servidor web e API
├── src/cerebro.js       # conversa com o Claude e executa as ferramentas
├── src/ferramentas.js   # notas, lembretes e finanças (definições das ferramentas)
├── src/db.js            # armazenamento em dados/jarvis.json
├── public/              # interface (HTML, CSS e JS com voz)
└── test/                # testes: npm test
```

As conversas ficam na memória do servidor e somem quando ele reinicia. Notas, lembretes e finanças ficam salvos em `dados/jarvis.json`.
