import { DeskShell } from "@/components/layout/DeskShell";
import { MercadoClient } from "@/components/mercado/MercadoClient";

// /mercado — secondary market for NFT shares ("válvula de escape").

export default function MercadoPage() {
  return (
    <DeskShell>
      <MercadoClient />
    </DeskShell>
  );
}
