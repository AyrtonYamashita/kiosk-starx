import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StarxLogo } from "@/components/brand/Logo";
import { privacyConfig } from "@/lib/privacy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Política de Privacidade · Starx Kiosk",
  description: "Como o Starx Kiosk trata dados pessoais, com quem compartilha e como exercer seus direitos.",
};

const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Política de privacidade pública (sem login). Texto: .lgpd/policies/privacy-policy-v1-draft.md. */
export default function PrivacyPage() {
  const c = privacyConfig();
  if (!c) notFound();
  const contact = (
    <a href={`mailto:${c.email}`} className="mono">
      {c.email}
    </a>
  );

  return (
    <main className="policy">
      <header className="policy-head">
        <Link href="/login" aria-label="Starx Kiosk">
          <StarxLogo size={30} />
        </Link>
      </header>

      <article className="card policy-body">
        <h1>Política de Privacidade</h1>
        <p className="muted small">
          Versão 1.0{c.effectiveDate ? ` · vigente desde ${fmtDate(c.effectiveDate)}` : ""}
        </p>

        <h2>1. Quem somos</h2>
        <p>
          O Starx Kiosk é um serviço por assinatura para empresas de logística. Ele gerencia coletores de dados (modo quiosque, apps e atualizações) e
          permite acompanhar a operação de descarga em tempo real. É fornecido por <strong>{c.company}</strong>, CNPJ {c.cnpj}
          {c.address ? `, ${c.address}` : ""} (&quot;nós&quot;).
        </p>

        <h2>2. Dois papéis diferentes</h2>
        <ul>
          <li>
            <strong>Como controlador</strong>: tratamos os dados do nosso próprio negócio, como os contatos das empresas que contratam o serviço, a
            cobrança e a segurança da plataforma. As seções 3 a 9 tratam disso.
          </li>
          <li>
            <strong>Como operador</strong>: tratamos os dados que cada empresa cliente coloca no Starx Kiosk (dos colaboradores que usam os coletores
            e dos usuários do painel) em nome dela e segundo as instruções dela. Nesses casos, a empresa cliente é a controladora. A seção 10 explica.
          </li>
        </ul>

        <h2>3. Dados que tratamos como controlador</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Para quê</th>
                <th>Dados</th>
                <th>Base legal</th>
                <th>Por quanto tempo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Contratar, cobrar e dar suporte à assinatura</td>
                <td>nome, e-mail, telefone, cargo e empresa dos contatos dos clientes</td>
                <td>execução de contrato (Art. 7º, V)</td>
                <td>durante o contrato; depois, o necessário para cobrança ou defesa de direitos (Art. 7º, VI)</td>
              </tr>
              <tr>
                <td>Emitir notas fiscais e cumprir obrigações tributárias</td>
                <td>dados de faturamento</td>
                <td>obrigação legal (Art. 7º, II)</td>
                <td>5 anos, contados do 1º dia do ano seguinte</td>
              </tr>
              <tr>
                <td>Proteger a plataforma</td>
                <td>endereço IP, navegador, data e hora, eventos de acesso</td>
                <td>legítimo interesse em segurança (Art. 7º, IX)</td>
                <td>registros de acesso até 1 ano; tentativas sem conta até 30 dias; registros técnicos e cópias de segurança por poucas semanas</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>Não tratamos dados sensíveis e não vendemos dados pessoais.</p>

        <h2>4. Com quem compartilhamos</h2>
        <p>Usamos fornecedores que tratam dados em nosso nome, apenas para prestar o serviço:</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Para quê</th>
                <th>Onde</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{c.hosting}</td>
                <td>hospedagem do sistema e das cópias de segurança</td>
                <td>Brasil</td>
              </tr>
              <tr>
                <td>Vercel Inc.</td>
                <td>hospedagem do painel web</td>
                <td>processamento em São Paulo; empresa nos EUA</td>
              </tr>
              <tr>
                <td>Cloudflare, Inc.</td>
                <td>proteção e entrega das conexões</td>
                <td>rede global</td>
              </tr>
              <tr>
                <td>Resend</td>
                <td>envio do código de acesso por e-mail</td>
                <td>{c.mailRegion}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Quem usa o painel também carrega imagens de mapa da OpenFreeMap, serviço público que recebe a região consultada e o endereço IP de quem consulta.
          Também podemos compartilhar dados quando a lei ou uma autoridade exigir.
        </p>

        <h2>5. Transferência para outros países</h2>
        <p>
          Alguns fornecedores processam ou acessam dados fora do Brasil, principalmente nos EUA. Para esses destinos, adotamos as Cláusulas-Padrão
          Contratuais aprovadas pela ANPD (Resolução CD/ANPD nº 19/2024). Para a União Europeia e o Espaço Econômico Europeu, vale a decisão de adequação
          da ANPD (Resolução CD/ANPD nº 32/2026).
        </p>

        <h2>6. Cookies</h2>
        <p>
          O painel usa apenas cookies estritamente necessários: o de sessão (mantém você conectado), o da etapa de verificação em duas etapas e, se você
          escolher, o de &quot;confiar neste navegador&quot; por 30 dias. A preferência de tema claro/escuro fica no seu navegador. Não usamos cookies de
          publicidade, analytics ou rastreamento.
        </p>

        <h2>7. Segurança</h2>
        <p>
          Usamos conexões cifradas (HTTPS), senhas protegidas com Argon2id, códigos e tokens guardados apenas em forma irreversível, verificação em duas
          etapas no painel, bloqueio de tentativas repetidas, controle de acesso por perfil, registro das ações administrativas e cópias de segurança cifradas.
        </p>

        <h2>8. Seus direitos</h2>
        <p>Pelo Art. 18 da LGPD você pode pedir, de graça:</p>
        <ul>
          <li>confirmação de que tratamos seus dados;</li>
          <li>acesso e cópia;</li>
          <li>correção;</li>
          <li>anonimização, bloqueio ou eliminação do que for desnecessário;</li>
          <li>portabilidade;</li>
          <li>informação sobre com quem compartilhamos;</li>
          <li>eliminação, quando cabível;</li>
          <li>oposição, quando o tratamento descumprir a lei.</li>
        </ul>
        <p>A confirmação simplificada sai na hora; a resposta completa, em até 15 dias. Se não pudermos atender, explicaremos o motivo.</p>

        <h2>9. Contato</h2>
        <p>
          Canal de privacidade: {contact}
          {c.dpo ? (
            <>
              <br />
              Encarregado: {c.dpo}
            </>
          ) : null}
          <br />
          Você também pode reclamar à ANPD em{" "}
          <a href="https://www.gov.br/anpd" target="_blank" rel="noreferrer">
            www.gov.br/anpd
          </a>
          .
        </p>

        <h2>10. Dados que tratamos em nome das empresas clientes</h2>
        <p>
          Se você é colaborador de uma empresa que usa o Starx Kiosk, ou usuário do painel dessa empresa, quem decide sobre seus dados é a sua empresa. Por
          exemplo: leitura da tela do sistema SSW no coletor, cargas e volumes bipados, indicadores de andamento, última localização do coletor (se ligada),
          imagens de tela pedidas pelo suporte, dados do aparelho e da sua conta no painel.
        </p>
        <ul>
          <li>Para saber as finalidades, a base legal, os prazos ou para exercer seus direitos, procure o canal de privacidade da sua empresa.</li>
          <li>Se o pedido chegar a nós ({contact}), encaminhamos à sua empresa em até 2 dias úteis.</li>
          <li>Tratamos esses dados só para prestar o serviço contratado, com as proteções da seção 7. Não os usamos para fins próprios.</li>
        </ul>

        <h2>11. Crianças e adolescentes</h2>
        <p>O Starx Kiosk é um serviço para empresas e não é direcionado a menores de 18 anos.</p>

        <h2>12. Alterações</h2>
        <p>Mudanças relevantes serão informadas nesta página e, para os clientes, também por e-mail. As versões anteriores ficam disponíveis mediante pedido.</p>
      </article>
    </main>
  );
}
