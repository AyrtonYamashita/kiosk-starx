import { PageTransition } from "@/components/animate-ui/components/page-transition";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <PageTransition effect="flow">{children}</PageTransition>;
}
