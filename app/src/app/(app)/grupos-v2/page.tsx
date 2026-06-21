import { redirect } from "next/navigation";

// /grupos-v2 graduated into the official /grupos. The route is kept as a
// permanent redirect so any shared preview links land on the real screen
// instead of 404ing.
export default function GruposV2Redirect() {
  redirect("/grupos");
}
