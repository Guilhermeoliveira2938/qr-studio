# Gerador de QR Code

Gera QR Codes de links, textos e redes Wi-Fi. Dá para escolher as cores, o formato dos pontos e colocar um logo no centro. O resultado pode ser baixado em PNG ou SVG.

Tudo roda no navegador. O que você digita e a imagem do logo não são enviados a nenhum servidor.

Site: https://guilhermeoliveira2938.github.io/qr-studio/

## O que faz

- Três tipos de conteúdo: link, texto e Wi-Fi (com escape correto de caracteres especiais).
- Prévia que acompanha o que você digita.
- Sete paletas e cores livres. Avisa quando o contraste é baixo demais para o QR Code ser lido.
- Três formatos de ponto: quadrado, arredondado e círculo.
- Logo ou foto no centro (PNG, JPG, WebP, GIF ou SVG), com tamanho, formato e encaixe ajustáveis.
- Download em PNG (256 a 2048 px) e em SVG. O logo também vai dentro do SVG.
- Copiar a imagem, histórico dos últimos QR Codes e tema claro ou escuro.
- Funciona no celular e pelo teclado.

## Sobre o logo

Um logo cobre parte do QR Code, então o programa compensa:

- A resistência a danos fica fixa em **máxima** (30%) enquanto houver logo.
- O logo ocupa no máximo 28% da largura da área de dados, e os pontos que ficariam sob ele são removidos, em vez de aparecerem pela metade.
- Os três quadrados dos cantos nunca são tocados.

Mesmo assim, **escaneie com mais de um celular antes de imprimir**. Leitores diferentes toleram quantidades diferentes de área coberta. O logo não é guardado no histórico.

## Como rodar

Abra o `index.html` no navegador. Se preferir um servidor local:

```bash
python3 -m http.server 5173
```

e acesse <http://localhost:5173>.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Cores, espaçamentos, componentes, tema escuro e versão para celular |
| `app.js` | Lógica: gera o QR, desenha em canvas e SVG, logo, exportação, histórico |
| `vendor/qrcode.min.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), que calcula a matriz do QR Code |

## Como foi testado

Os QR Codes foram lidos de volta com o `BarcodeDetector` do navegador em todas as combinações de formato de ponto, formato do logo, encaixe e tamanho do logo (10% a 28%), com um link curto e um longo, além dos arquivos PNG e SVG baixados, textos com acentos e emoji e Wi-Fi com caracteres especiais. Isso não substitui testar com celulares de verdade.
