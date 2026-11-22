# Starx Kiosk — identidade visual

Fonte de verdade visual: o canvas "Starx Kiosk — Identidade visual" (Logotipo e símbolo, Cores e tipografia, Tokens, Ícones, Favicon e ícone do app, Painel claro e escuro). Este arquivo é o resumo para quem vai aplicar no código.

## Símbolo e logotipo

- **Símbolo:** quatro cantos de mira (o coletor lendo, o aparelho travado na tarefa) com uma estrela de quatro pontas girada 45° (o X de Starx). Arquivos em `assets/`.
- **Logotipo:** símbolo + "Starx **Kiosk**" em Space Grotesk 700; "Kiosk" em peso 500 na cor de marca.
- **Cores do símbolo:** claro = cantos `#0A1A2F` e estrela `#1560D4`. Escuro = cantos `#E8EEF7` e estrela `#5B9BF5`. Monocromático: `#334155`.
- **Respiro:** um quarto da altura do símbolo. **Mínimo:** símbolo 16 px; logotipo completo 96 px de largura.
- **Favicon:** só a estrela, branca sobre quadrado azul `#1560D4` (a 16 px os cantos somem). **Ícone do app:** símbolo completo, branco sobre azul; versão maskable com mais margem.
- Não girar, esticar, recolorir fora da paleta nem aplicar sombra no símbolo.

## Cores

Definidas em `web/tokens.css` (claro e escuro, mesmos nomes de variável que o painel já usa). Resumo:

| Papel | Claro | Escuro |
|---|---|---|
| canvas (fundo) | `#F8FAFC` | `#050B14` |
| surface (cartão) | `#FFFFFF` | `#0E1A2B` |
| line | `#E2E8F0` | `#1E3350` |
| ink | `#0A1A2F` | `#E8EEF7` |
| mid | `#334155` | `#B3C2D6` |
| soft | `#5B6B80` | `#93A4BA` |
| blue (ação, marca) | `#1560D4` | `#5B9BF5` |
| on-blue | `#FFFFFF` | `#071326` |
| blue-deep (texto azul) | `#0F4DB0` | `#8DBBFA` |
| blue-tint | `#EEF4FD` | `#12294A` |
| good / warn / bad | `#15803D` / `#B45309` / `#B91C1C` | `#4ADE80` / `#FBBF24` / `#F87171` |

Regras:
- O escuro é azul-marinho, nunca preto puro. O azul de ação **clareia** no escuro e o texto sobre ele fica escuro (`on-blue`).
- Estado nunca aparece só em cor: sempre ponto + texto (Online, Em modo kiosk, Bateria baixa, Offline).
- Texto com contraste de 4,5:1 ou mais em todos os pares dos tokens. `faint` e `muted` são decorativos, nunca texto.
- Bordas, não sombras. A única sombra é `--shadow-float` (Toast, Modal, Drawer).
- Nada de cor literal fora de `tokens.css`.

## Tipografia

- **Títulos e logotipo:** Space Grotesk 500/700, tracking -0.02em a -0.03em. Variável `--font-display`.
- **Interface:** Inter 400/500/600. Variável `--font-sans`.
- **Dado de máquina** (serial, IP, pacote, versão, hora): IBM Plex Mono 400/500, que o painel já carrega. Variável `--font-mono`. Use `tabular-nums` em números.
- Carregar com `next/font/google`. Remover Outfit.

## Superfícies, raios e alturas

- Cartões e menu sobre o fundo são **vidro**: classe `.glass` (72–74% de opacidade, desfoque de 18 px, borda visível).
- Raios: 4px em tudo (chip, menu, campo/botão, cartão, pílula e vidro). Só pontos de status, o pino do mapa e as bolhas do fundo são redondos.
- Alvo de toque mínimo 44 px (botões, itens de menu, segmentos, alternador de tema).

## Fundo: Bubble (Animate UI)

- Componente: `npx shadcn@latest add @animate-ui/backgrounds-bubble`. Props usadas: `colors` (seis strings "r,g,b"), `interactive`, `className`.
- **Monocromático nos dois modos:** seis tons do mesmo azul. Valores em `web/StarxBackground.tsx`.
  - Claro: base `#F3F7FD → #DCE9FC`.
  - Escuro: base `#04080F → #070F1D`, bolhas em azuis profundos e de baixa opacidade: o azul só sugere, não domina.
- Presente em **todas** as páginas, atrás de tudo (`fixed inset-0 -z-10`), uma vez no layout raiz. `interactive` só no login.
- Se o componente instalado trouxer um gradiente de base próprio, o `className` precisa sobrescrevê-lo. Ajustar a opacidade se as bolhas competirem com as tabelas.
- Respeitar `prefers-reduced-motion`.

## Ícones

- Biblioteca: `lucide-react` (já no painel) com a versão animada do Animate UI: `npx shadcn@latest add @animate-ui/icons-lucide-<nome>`. O primeiro instala o núcleo (`@animate-ui/react/icons`).
- **Todo ícone anima quando possível.** Padrão: `animateOnHover` + `animateOnTap` no pai (`<AnimateIcon animateOnHover animateOnTap asChild><button>…`), assim o ícone anima ao passar o mouse no botão inteiro. `animateOnView` para estados vazios. `loop` só para algo realmente em andamento (sincronizando, carregando).
- Tamanho 18 px no menu, 20 px em botões, traço 1,75.
- O que não existir na coleção animada usa `web/AnimatedIcon.tsx` (envolve o ícone estático do `lucide-react` com um movimento: wiggle, pulse, hop, drive, spin, blink, slide, drop, tilt).

| Uso | Lucide | Animado no Animate UI? | Movimento do fallback |
|---|---|---|---|
| Coletor / Aparelhos | `smartphone` | sim | |
| Acompanhamento | `activity` | sim | |
| Perfis / Políticas | `sliders-horizontal` | sim | |
| Apps | `package` | não | hop |
| Cadastro (QR) | `qr-code` | não | pulse |
| Código de barras | `scan-barcode` | não | pulse |
| Entrega | `truck` | não | drive |
| Depósito | `warehouse` | não | hop |
| Apps permitidos | `layout-grid` | não | pulse |
| Sincronização | `refresh-cw` | sim | |
| Bateria | `battery-charging`, `battery-low` | sim | |
| Conectividade | `wifi`, `wifi-off` | sim | |
| Bloqueio remoto | `lock` | sim | |
| Localização | `map-pin` | sim | |
| Atualização | `download` | sim | |
| Alerta | `triangle-alert` | sim | |
| Grupo de coletores | `layers` | sim | |
| Usuários / Conta / Sair | `shield-check`, `user-round`, `log-out` | sim | |
| Tema | `sun`, `moon` | sim | |
| **Modo kiosk** | próprio: `assets/kiosk-mode.svg` | não | pulse |

A tabela de "sim/não" vem da lista publicada do Animate UI na data da criação; conferir de novo com `npx shadcn@latest add @animate-ui/icons-lucide-<nome>` antes de usar o fallback.

## Página do dispositivo (`/devices/[id]`)

Referência: páginas "Dispositivo · modo escuro" e "Dispositivo · modo claro" do canvas.

- **Mapa em tela cheia:** na página do dispositivo o mapa da localização é o **fundo da tela toda** (1440×900 no canvas; `position:absolute; inset:0` atrás do menu lateral e dos cards). OpenMapTiles: escuro = Dark Matter, claro = estilo claro do mesmo esquema. O Bubble continua como fundo nas demais páginas e aqui quando não há localização.
- **Cards sobre o mapa** com **vidro líquido** (`.liquid-glass` + `<LiquidGlassDefs />`, refração em Chromium e vidro fosco nos outros). Margem de 24 px da borda da tela e 16 px entre colunas.
- **Cantos:** card e menu lateral de vidro com `border-radius: 4px`, como o resto do painel; o que fica dentro também usa 4px.
- **Esquerda (440 px, topo em 24 px):** um card compacto com voltar, nome, online/offline, último contato e, numa linha, Bateria, Rede, Armazenamento e Memória (sem ícones, só título e valor). Abaixo, um card com **abas de texto sublinhadas** (ativa: texto `ink`, peso 600, sublinhado 2 px azul; inativa: `soft`, sem borda): Comandos · Leitura SSW · Apps · JSON. O card tem **altura automática** (conteúdo limitado a 340 px, rola por dentro). Fontes menores que o resto do painel (nome 17 px, texto 11–12,5 px).
- **Aba Comandos:** apenas 4 botões em uma linha, ícone em cima e rótulo curto embaixo (Bloquear, Recarregar, Capturar, Reiniciar em vermelho) e a nota "Chegam em até 30 s.". **Sem campo de mensagem e sem lista de últimos comandos** nesta tela (decisão do design); mantenha os endpoints e componentes existentes, só não os renderize aqui.
- **Direita (440 px, 24 px de margem):** card **Aparelho** (modelo, serial, Android, patch, ligado há, app StarX, kiosk, usuário no SSW, cadastro) e card **Configuração pelo painel** (status, perfil, apps gerenciados, salvar e reaplicar), alinhados ao topo e à base do menu lateral.
- **Centro livre:** marcador de posição com círculo de precisão e um cartão com coordenadas, precisão, fonte, idade e "Abrir no Google Maps"; crédito do mapa embaixo.
- **Regras de exibição:**
  - Perfil sem suporte a apps gerenciados: a seção "Apps gerenciados pelo perfil" **não aparece**.
  - Kiosk em modo **site** (`mode: "web"`): a aba **Apps** (instalados) **não aparece**.
  - Sem localização: sem mapa; o fundo é o Bubble e o cartão da posição vira uma mensagem curta.
- Alvos de 44 px; texto sempre com contraste de 4,5:1 sobre o vidro (por isso o vidro é mais opaco do que "transparente").

## Android (app Kotlin)

- Tela do kiosk e rodapé: fundo `starx_night` `#070E1A` (substitui `#001425`), texto `starx_night_ink`.
- Telas de configuração (claras): acento `starx_blue`, fundo `starx_canvas`.
- Ícone do app: adaptativo (`assets/android/`), com camada monocromática para ícones temáticos do Android 13+. `ic_kiosk` troca o escudo pelo símbolo.
- Fontes: Space Grotesk (títulos) e Inter (texto) como recursos de fonte, no lugar de Outfit. Manter IBM Plex Mono para dados de máquina.
- Sem Bubble e sem Animate UI no Android (são do painel web).

## Não fazer

- Outro azul, outro matiz de acento ou gradiente colorido no fundo.
- Cor sem texto para indicar estado.
- Preto puro no modo escuro, ou branco puro de fundo no claro (usar `canvas`).
- Ícone estático onde há versão animada.
- Sombra em cartão.
