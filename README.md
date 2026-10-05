# 📱 QR Studio · Gerador de QR Code

Site que cria QR Codes de **links**, **textos** e **redes Wi-Fi**. Dá para personalizar cores e estilo e baixar em **PNG** ou **SVG**.

Tudo é gerado **no navegador**: nada do que você escreve é enviado para a internet.

## ✨ Recursos

- Três tipos de conteúdo: Link, Texto e Wi-Fi (com escape correto de caracteres especiais)
- Prévia que atualiza enquanto você digita
- 7 paletas prontas + cores personalizadas, com **aviso de contraste baixo** (QR Code com pouco contraste não é lido)
- 3 estilos de ponto: quadrado, arredondado e pontos
- Download em **PNG** (256 a 2048 px) e **SVG** (vetorial, bom para impressão)
- Copiar a imagem para a área de transferência
- Histórico dos últimos QR Codes (fica só no seu navegador)
- Tema claro e escuro (segue o sistema e tem botão)
- Acessível: navegação por teclado, foco visível, leitores de tela e respeito a "reduzir movimento"
- Responsivo: funciona no celular, tablet e computador
- Funciona offline depois de aberto (a biblioteca está dentro do projeto)

## ▶️ Como rodar

Não precisa instalar nada. Basta abrir o arquivo `index.html` no navegador.

Se preferir um servidor local:

```bash
python3 -m http.server 5173
```

e abrir <http://localhost:5173>.

## 🗂️ Estrutura

| Arquivo | Para que serve |
|---|---|
| `index.html` | Estrutura e textos da página |
| `styles.css` | Sistema de design: cores, espaçamentos, componentes, tema escuro e responsivo |
| `app.js` | Lógica: gera o QR, desenha (canvas e SVG), exporta, histórico e tema |
| `vendor/qrcode.min.js` | Biblioteca [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), que calcula a matriz do QR Code |

## 🧰 Tecnologias

HTML5 · CSS3 (variáveis, grid, `color-mix`) · JavaScript puro · Canvas API · [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)

## ✅ Como foi testado

Os QR Codes gerados foram lidos de volta com o `BarcodeDetector` do navegador em todas as combinações de estilo, nível de resistência e paleta, além de textos com acentos e emoji e dos arquivos PNG e SVG baixados.
