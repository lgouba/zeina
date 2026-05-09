import { ActivationFlow } from "./ActivationFlow";

export function FirstLoginPage() {
  return (
    <ActivationFlow
      purpose="first_login"
      title="Activer mon compte"
      intro="Saisissez le code reçu par email"
    />
  );
}
