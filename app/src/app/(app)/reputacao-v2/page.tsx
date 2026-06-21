import { redirect } from "next/navigation";

// /reputacao-v2 graduated into the official /reputacao. The route is kept as a
// permanent redirect so any shared preview links land on the real screen
// instead of 404ing.
export default function ReputacaoV2Redirect() {
  redirect("/reputacao");
}
