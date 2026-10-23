import { redirect } from "next/navigation";

// «Сегодня» becomes the home screen at stage 3
export default function Home() {
  redirect("/orders");
}
