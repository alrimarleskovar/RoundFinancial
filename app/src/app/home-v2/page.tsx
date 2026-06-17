import { redirect } from "next/navigation";

// /home-v2 graduated into the official /home (PR #494 → follow-up). The
// route is kept as a permanent redirect so any shared preview links land
// on the real dashboard instead of 404ing.
export default function HomeV2Redirect() {
  redirect("/home");
}
