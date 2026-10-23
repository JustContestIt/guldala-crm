import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { login } from "./actions";

export const metadata: Metadata = { title: "Вход" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-center">Guldala CRM</h1>
      <div className="card">
        <ActionForm action={login}>
          <Field label="Логин">
            <input name="login" className="input" autoComplete="username" autoCapitalize="none" required />
          </Field>
          <Field label="Пароль">
            <input name="password" type="password" className="input" autoComplete="current-password" required />
          </Field>
          <Submit className="btn-primary w-full">Войти</Submit>
        </ActionForm>
      </div>
    </main>
  );
}
