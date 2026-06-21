import { redirect } from "next/navigation";

// /insights-v2 graduated into the official /insights. The route is kept as a
// permanent redirect so any shared preview links land on the real screen
// instead of 404ing.
export default function InsightsV2Redirect() {
  redirect("/insights");
}
