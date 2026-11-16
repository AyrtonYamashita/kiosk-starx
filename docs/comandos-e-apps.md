# Comandos e apps (fase 4)

Os comandos chegam em cerca de 1 s. O app (0.4.1 ou mais novo) mantém uma espera aberta na API
(`GET /v1/device/wait`, long polling de até 50 s); quando o painel cria um comando ou muda a configuração do
aparelho, a espera termina na hora e o app faz o check-in, recebe e executa. O resultado volta logo em seguida.
O check-in a cada 30 s continua como reserva (app 0.4.0, rede instável, tela desligada por muito tempo — o Android
corta a rede de apps em segundo plano no modo de economia).

Exige o app **0.4.0** ou mais novo no aparelho. Aparelhos com a 0.3.x precisam ser atualizados uma vez (ADB, ou QR
num aparelho resetado). A partir daí, o app se atualiza sozinho.

## Comandos

Na página do aparelho (**Comandos**) ou para vários de uma vez (marque na lista de **Aparelhos**).

| Comando | O que faz | Validade |
|---|---|---|
| Bloquear tela | Desliga a tela (`lockNow`). Sem senha de bloqueio, basta ligar a tela de novo. | 30 min |
| Recarregar kiosk | Site: volta à página inicial. Grade: redesenha. App único: fecha o app e abre de novo. | 30 min |
| Capturar tela | Imagem da tela do kiosk (veja a limitação abaixo). O painel guarda as 10 últimas de cada aparelho. | 10 min |
| Mensagem | Janela por cima do kiosk até alguém tocar em **OK**. O painel mostra "exibida" e depois "lida às HH:MM". | 4 h |
| Instalar app | Instala ou atualiza um app do repositório, sem tela. Nunca rebaixa a versão. | 7 dias |
| Remover app | Remove um app instalado (com os dados dele). O app do kiosk não pode ser removido. | 7 dias |
| Reiniciar | Reinicia o aparelho. O resultado ("reiniciando") é enviado antes. | 30 min |

**Validade:** um comando que não chega ao aparelho a tempo (desligado, sem rede) expira e não é mais executado.
Isso evita, por exemplo, um aparelho reiniciar horas depois de ser ligado. Enquanto não foi entregue, dá para
**cancelar** na lista de comandos.

**Situações:** aguardando o aparelho → em execução (entregue) → concluído / falhou. Ou expirou / cancelado.

**Repetição:** o painel reenvia o comando a cada contato até receber o resultado. O app lembra os últimos 200
comandos executados e não repete nenhum, nem depois de reiniciar.

### Captura de tela: limitação

A captura usa a própria janela do app (PixelCopy), sem permissão especial nem confirmação no aparelho. Por isso ela
mostra só as telas do StarX Kiosk: o **site** (modo site), a **grade**, as configurações e as mensagens. Com um app de
terceiros na frente (modo **app único**) ou a tela desligada, o comando falha com essa explicação. O Android só deixa
capturar a tela de outro app com uma confirmação manual no próprio aparelho, a cada sessão.

## Repositório de apps

Menu **Apps**. Envie o `.apk`: o pacote, a versão e a assinatura são lidos do próprio arquivo.

- O arquivo vai do navegador **direto para a API**, com um token de uso único gerado pelo painel. A Vercel não aceita
  arquivos acima de 4,5 MB. O limite é `MAX_APK_MB` (95 MB por padrão; a Cloudflare grátis aceita até 100 MB).
- Uma versão nova precisa ter **versionCode maior** e a **mesma assinatura**: o Android recusaria instalar por cima.
  Para trocar a assinatura, remova o app do repositório e envie de novo. Nos aparelhos, o app precisa ser removido antes.
- Os aparelhos baixam o APK com o próprio token e conferem tamanho e SHA-256 antes de instalar.

### Apps gerenciados pelo perfil

No perfil, marque os apps em **Apps gerenciados**. Os aparelhos com esse perfil:

1. instalam os apps que faltam;
2. atualizam sozinhos quando uma versão mais nova é enviada ao repositório;
3. nunca rebaixam a versão e nunca removem nada. Tirar um app do perfil só para de gerenciar: para remover dos
   aparelhos, use o comando **Remover app**.

Se uma instalação falha, o aparelho tenta de novo com espera crescente: 5 min, 10, 20… até 6 h. Uma versão nova
no repositório é tentada na hora. A página do aparelho mostra a situação de cada app gerenciado e o último erro.

Para o kiosk usar um app gerenciado (modo app único ou grade), coloque o pacote também na configuração do perfil.
Enquanto o app não chega, a tela do kiosk mostra "aguardando a instalação".

## Atualização do próprio app do kiosk

Quando um APK novo do StarX Kiosk é publicado — no painel, em Apps → "App do kiosk" (enviar e depois Publicar), ou
pelo terminal (`publishApk` → `deploy/data/apks`, veja [deploy/README.md](../deploy/README.md)) — os aparelhos com versão mais velha baixam e se atualizam no próximo
contato. A atualização substitui o app sem tirar o Device Owner nem a configuração. O kiosk volta sozinho, e a
versão nova aparece no painel no check-in seguinte. Para desligar: `AUTO_UPDATE_APP=false` no `.env` da VPS.

A assinatura tem de ser a mesma (keystore de release em `~/.starx-kiosk/signing`). Um build de debug não atualiza um
aparelho provisionado com o build de release.
