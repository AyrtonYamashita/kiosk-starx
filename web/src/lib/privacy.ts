import "server-only";

/*
  Página pública /privacidade (LGPD, Art. 9º). Os dados do fornecedor vêm do ambiente (Vercel), não do código, e a
  página só existe com PRIVACY_PUBLISHED=1 e com razão social, CNPJ e e-mail do canal preenchidos. Enquanto isso,
  /privacidade responde 404 e o link não aparece. O texto segue a minuta .lgpd/policies/privacy-policy-v1-draft.md
  (publicar só depois da revisão jurídica).
*/
export interface PrivacyConfig {
  company: string;
  cnpj: string;
  address: string | null;
  email: string;
  /** Encarregado (nome; ou empresa + responsável), se designado */
  dpo: string | null;
  /** provedor do servidor (hospedagem da API, do banco e dos backups) */
  hosting: string;
  /** região do envio de e-mails (Resend) */
  mailRegion: string;
  /** data de vigência exibida (AAAA-MM-DD) */
  effectiveDate: string;
}

const env = (k: string) => process.env[k]?.trim() || null;

/** A configuração, ou null quando a página não deve existir. */
export function privacyConfig(): PrivacyConfig | null {
  if (env("PRIVACY_PUBLISHED") !== "1") return null;
  const company = env("PRIVACY_COMPANY");
  const cnpj = env("PRIVACY_CNPJ");
  const email = env("PRIVACY_EMAIL");
  if (!company || !cnpj || !email) return null;
  return {
    company,
    cnpj,
    email,
    address: env("PRIVACY_ADDRESS"),
    dpo: env("PRIVACY_DPO"),
    hosting: env("PRIVACY_HOSTING") ?? "provedor de servidores no Brasil",
    mailRegion: env("PRIVACY_MAIL_REGION") ?? "região informada pelo fornecedor",
    effectiveDate: env("PRIVACY_EFFECTIVE_DATE") ?? "",
  };
}
