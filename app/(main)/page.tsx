import { redirect } from "next/navigation";

// Home on the phone is the orders board (spec §5.1, revision 23.10.2026); «Сегодня» is /today
export default function Home() {
  redirect("/orders");
}
