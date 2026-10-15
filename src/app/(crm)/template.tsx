import { PageTransition } from "@/components/motion/page-transition";

/** Remounted by Next on every navigation, so each page plays its entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
