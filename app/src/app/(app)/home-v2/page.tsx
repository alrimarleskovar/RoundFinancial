import { redirect } from "next/navigation";

// /home-v2 graduated into the official /home. The route is kept as a permanent
// redirect so any shared preview links land on the real screen instead of
// 404ing.
export default function HomeV2Redirect() {
  redirect("/home");
}
