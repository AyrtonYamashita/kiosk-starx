# Prompt para o Claude Code

Cole o texto abaixo na raiz do repositório `kiosk-starx`, com esta pasta (`starx-kiosk-brand/`) copiada para dentro dele.

---

Aplique a nova identidade visual do Starx Kiosk neste repositório. Leia primeiro `starx-kiosk-brand/BRAND.md` por inteiro e `web/AGENTS.md` (este Next.js é uma versão com mudanças; consulte `node_modules/next/dist/docs/` antes de usar uma API). Trabalhe em uma branch `brand-starx` e faça um commit por fase. Não mude comportamento, rotas, API nem testes existentes: é só visual.

## Fase 1 — painel web (`web/`)

1. **Ferramentas.** O painel hoje usa CSS próprio em `globals.css`; confira se já há Tailwind. Se não houver, instale o Tailwind v4 (`tailwindcss`, `@tailwindcss/postcss`, `postcss.config.mjs`, `@import "tailwindcss"`). Instale também `next-themes` e `motion`. Rode `npx shadcn@latest init` (só o necessário, alias `@/`) e registre o `@animate-ui` conforme `https://animate-ui.com/docs/installation`.
2. **Tokens.** Substitua o bloco de variáveis de `globals.css` por `starx-kiosk-brand/web/tokens.css`. Os nomes de variável são os mesmos, então o CSS existente continua valendo. Troque o modo escuro por `prefers-color-scheme` pelo modo por classe `.dark`. Procure e elimine qualquer cor literal fora do `tokens.css`.
3. **Fontes.** Em `layout.tsx`, troque Outfit por Space Grotesk (`--font-space-grotesk`) e Inter (`--font-inter`), mantendo IBM Plex Mono. Envolva a árvore em `ThemeProvider` do `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`) e coloque `suppressHydrationWarning` no `<html>`.
4. **Fundo.** Instale o Bubble (`npx shadcn@latest add @animate-ui/backgrounds-bubble`), copie `StarxBackground.tsx` e renderize no layout raiz, uma vez, para todas as páginas, inclusive o login (com `interactive` só no login). Leia o componente instalado: o gradiente de base dele precisa ser sobrescrito pelo `className` para ficar monocromático nos dois modos. Ajuste cartões e menu para a classe `.glass`.
5. **Marca.** Troque o quadrado `<span className="mark">` do `Sidebar` e a marca do login pelo logotipo (símbolo + "Starx Kiosk"). Crie `src/app/icon.svg`, `src/app/apple-icon.png` e `src/app/favicon.ico` a partir de `starx-kiosk-brand/assets/web/`. Atualize o `metadata` e, se existir, o `manifest`, com `icon-192.png`, `icon-512.png` e `icon-512-maskable.png` de `starx-kiosk-brand/assets/`.
6. **Modo escuro.** Adicione o `ThemeToggle` no cabeçalho do painel e na tela de login. Percorra todas as telas e componentes e corrija o que não respeitar os tokens: cartões, tabelas, formulários, QR, modais, avisos, gráficos, mapa da localização, página de cadastro por ADB. O QR precisa continuar legível no escuro (fundo claro fixo).
7. **Ícones animados.** Troque os ícones do `lucide-react` pelos animados do Animate UI, seguindo a tabela do `BRAND.md` (pai com `AnimateIcon animateOnHover animateOnTap asChild`). Os que não existirem na coleção usam `AnimatedIcon.tsx`. O ícone de "Modo kiosk" é o `assets/kiosk-mode.svg`. Confirme que as animações respeitam `prefers-reduced-motion`.
8. **Página do dispositivo.** Reorganize `devices/[id]/page.tsx` conforme a seção "Página do dispositivo" do `BRAND.md` e as páginas "Dispositivo" do canvas: mapa em **tela cheia** como fundo da página (`DeviceMap.tsx`, `maplibre-gl`; pergunte qual fonte de tiles usar se as variáveis do `.env.example` estiverem vazias, sem deixar chave no código), cards com `.liquid-glass` e `LiquidGlassDefs`, raios concêntricos (card 28 px, padding 16 px, controles internos 12 px), estado à esquerda com abas sublinhadas (Comandos, Leitura SSW, Apps, JSON), aparelho e configuração à direita. A aba Comandos mostra só os 4 botões; não renderize mensagem na tela nem últimos comandos aqui, mas não apague os endpoints nem os componentes. Reaproveite `DeviceCommands`, `AppsTable`, `DeviceConfig`, `OpsReaderToggle`, `ManagedAppsStatus`, `DeviceLocation`. Respeite as regras de exibição: sem apps gerenciados no perfil, nem renderize a seção; kiosk em modo site, nem renderize a aba Apps; sem localização, sem mapa.
9. **Conferência.** Rode `npm run typecheck` e `npm run build`. Abra cada rota (login, login/verify, operations e detalhe, aparelhos e detalhe, perfis, apps, cadastro e detalhe, usuários, conta) em claro e escuro, em 1440 px e 390 px, e corrija contraste, quebras e sobreposição com o fundo. Estado sempre com ponto e texto.

## Fase 2 — app Android (`android/`)

1. `ui/Theme.kt` e `res/values/colors.xml`: troque a família de acento `#98CEFF … #001425` pelos tokens de `assets/android/values/colors_starx.xml`. Mantenha a regra "nada de cor literal fora do Theme".
2. Fontes: troque Outfit por Space Grotesk (títulos) e Inter (texto) em `res/font/` e `assets/fonts/`, com as licenças OFL junto. Mantenha IBM Plex Mono.
3. Ícone do app: copie `assets/android/drawable/ic_launcher_foreground.xml` e `assets/android/mipmap-anydpi-v26/` para `res/`, adicione `android:icon` e `android:roundIcon` no `AndroidManifest.xml`. Substitua `ic_kiosk.xml` pelo novo.
4. Não adicione bibliotecas (o app é sem AndroidX por decisão). Rode `./gradlew testDebugUnitTest assembleDebug`.

## Entrega

Resuma o que mudou por fase, liste qualquer tela que ficou fora do padrão e por quê, e anexe capturas de tela do painel em claro e escuro.
