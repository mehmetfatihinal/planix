"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  Badge,
  Brain,
  Building2,
  ChevronDown,
  Eye,
  Languages,
  Lightbulb,
  Lock,
  Mail,
  Network,
  RotateCcw,
  ShieldCheck,
  User
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/auth-state";
import { useAppState } from "@/lib/app-state";
import { getLanguageMeta, languages } from "@/lib/i18n";
import type { LanguageCode } from "@/types/business";

export function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorKey("");
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (error) {
      setErrorKey(isApiConnectionError(error) ? "auth.apiOffline" : "auth.loginFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout variant="login">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#151c25]/80 p-8 shadow-[0_25px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl lg:p-10">
        <MobileBrand />
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-[#f4f7fb]">{t("auth.loginWelcome")}</h2>
          <p className="mt-3 text-sm leading-6 text-[#dfbfbf]">{t("auth.loginSubtitle")}</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <AuthField
            icon={Mail}
            label={t("auth.emailOrUsername")}
            placeholder="ornek@sirket.com  ·  admin"
            value={email}
            onChange={setEmail}
            type="text"
          />
          <AuthField
            icon={Lock}
            label={t("auth.password")}
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            type="password"
            rightLabel={t("auth.forgotPassword")}
          />
          <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#dfbfbf]">
            {t("auth.adminHint")}
          </p>
          {errorKey ? <p className="rounded-lg bg-[#93000a]/25 px-3 py-2 text-sm text-[#ffb4ab]">{t(errorKey)}</p> : null}
          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#b03040] px-4 py-3 text-sm font-semibold text-[#ffd0d1] shadow-lg shadow-[#b03040]/20 transition hover:bg-[#c13b4d] focus:outline-none focus:ring-2 focus:ring-[#ffb3b5] disabled:cursor-wait disabled:opacity-70"
            type="submit"
          >
            {busy ? t("auth.loading") : t("auth.login")}
            <ArrowRight size={18} />
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-[#dfbfbf]">
          {t("auth.noAccount")}{" "}
          <Link href="/register" className="font-semibold text-[#ffb3b5] transition hover:text-white">
            {t("auth.register")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useAppState();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setErrorKey("auth.passwordMismatch");
      return;
    }

    setBusy(true);
    setErrorKey("");
    try {
      await register(`${firstName} ${lastName}`.trim(), email, password);
      router.replace("/dashboard");
    } catch (error) {
      setErrorKey(isApiConnectionError(error) ? "auth.apiOffline" : "auth.registerFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout variant="register">
      <div className="w-full max-w-[480px] py-8">
        <MobileBrand compact />
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-semibold text-white">{t("auth.registerTitle")}</h2>
          <p className="mt-3 text-sm leading-6 text-[#dfbfbf]">{t("auth.registerSubtitle")}</p>
        </div>

        <div className="rounded-xl border border-[#b03040]/35 bg-[#2e353f]/40 p-6 shadow-[0_8px_32px_rgba(176,48,64,0.08)] backdrop-blur-xl">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AuthField
                icon={User}
                label={t("auth.firstName")}
                placeholder={t("auth.firstNamePlaceholder")}
                value={firstName}
                onChange={setFirstName}
                compact
              />
              <AuthField
                icon={Badge}
                label={t("auth.lastName")}
                placeholder={t("auth.lastNamePlaceholder")}
                value={lastName}
                onChange={setLastName}
                compact
              />
            </div>
            <AuthField
              icon={Mail}
              label={t("auth.email")}
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={setEmail}
              type="email"
              compact
            />
            <AuthField
              icon={Lock}
              label={t("auth.password")}
              placeholder="••••••••"
              value={password}
              onChange={setPassword}
              type="password"
              trailingIcon={Eye}
              compact
            />
            <AuthField
              icon={RotateCcw}
              label={t("auth.confirmPassword")}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type="password"
              compact
            />
            {errorKey ? <p className="rounded-lg bg-[#93000a]/25 px-3 py-2 text-sm text-[#ffb4ab]">{t(errorKey)}</p> : null}
            <button
              disabled={busy}
              className="w-full rounded-md bg-[#b03040] px-4 py-[14px] text-sm font-semibold text-white shadow-[0_4px_12px_rgba(176,48,64,0.22)] transition hover:bg-[#8c1329] focus:outline-none focus:ring-2 focus:ring-[#b03040] focus:ring-offset-2 focus:ring-offset-[#0d141d] disabled:cursor-wait disabled:opacity-70"
              type="submit"
            >
              {busy ? t("auth.loading") : t("auth.register")}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-[#dfbfbf]">
          {t("auth.hasAccount")}{" "}
          <Link href="/login" className="font-semibold text-[#ffb3b5] transition hover:text-white">
            {t("auth.login")}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

function AuthLayout({ variant, children }: { variant: "login" | "register"; children: React.ReactNode }) {
  const { language, setLanguage, t } = useAppState();
  const meta = getLanguageMeta(language);
  const register = variant === "register";

  return (
    <main className="auth-tech-bg relative flex min-h-screen overflow-hidden bg-[#0d141d] text-[#dce3f0]">
      <LanguageSelector
        language={language}
        setLanguage={setLanguage}
        label={t("settings.language")}
        currentLabel={meta.label}
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col lg:flex-row">
        <BrandPanel register={register} />
        <section
          className={[
            "flex flex-1 items-center justify-center p-6 lg:p-12",
            register ? "lg:w-7/12" : ""
          ].join(" ")}
        >
          {children}
        </section>
      </div>
      <div className="absolute bottom-6 left-6 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#192029] text-xs font-bold text-[#dce3f0] shadow-md">
        N
      </div>
    </main>
  );
}

function isApiConnectionError(error: unknown) {
  return error instanceof TypeError || String(error).toLowerCase().includes("failed to fetch");
}

function LanguageSelector({
  language,
  setLanguage,
  label,
  currentLabel
}: {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  label: string;
  currentLabel: string;
}) {
  return (
    <label className="absolute right-4 top-4 z-20 inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#192029]/80 px-3 text-sm font-semibold text-[#dce3f0] shadow-lg backdrop-blur-sm sm:right-6 sm:top-6">
      <Languages size={17} />
      <span className="sr-only">{label}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as LanguageCode)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      >
        {languages.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
      <span>{currentLabel}</span>
      <ChevronDown size={16} />
    </label>
  );
}

function BrandPanel({ register }: { register: boolean }) {
  const { t } = useAppState();

  return (
    <section
      className={[
        "relative hidden flex-1 flex-col overflow-hidden p-12 lg:flex",
        register ? "justify-start" : "justify-between",
        register ? "lg:w-5/12 lg:p-10" : "lg:p-24"
      ].join(" ")}
    >
      {register ? <div className="auth-register-visual" /> : null}
      <div className="relative z-10">
        <BrandMark compact={register} />
        <div className={register ? "mt-12" : "mt-14"}>
          <h1 className={register ? "max-w-md text-4xl font-extrabold leading-tight text-white" : "max-w-xl text-5xl font-bold leading-[1.08] text-white"}>
            {t("auth.heroLineOne")} <br />
            <span className="text-[#ffb3b5]">{t("auth.heroHighlight")}</span> {t("auth.heroLineTwo")}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[#dfbfbf]">{register ? t("auth.registerHeroText") : t("auth.heroText")}</p>
        </div>
      </div>

      <div className={["relative z-10 space-y-4", register ? "mt-10" : "mt-12"].join(" ")}>
        {register ? (
          <>
            <FeatureCard icon={ShieldCheck} title={t("auth.featureSecurityTitle")} text={t("auth.featureSecurityText")} />
            <FeatureCard icon={Lightbulb} title={t("auth.featureInsightsTitle")} text={t("auth.featureInsightsText")} />
          </>
        ) : (
          <>
            <FeatureRow icon={Network} title={t("auth.featureIntegrationTitle")} text={t("auth.featureIntegrationText")} />
            <FeatureRow icon={Brain} title={t("auth.featureAiTitle")} text={t("auth.featureAiText")} />
            <FeatureRow icon={ShieldCheck} title={t("auth.featureSecurityTitle")} text={t("auth.featureSecurityText")} />
          </>
        )}
      </div>

      {!register ? (
        <div className="relative z-10 mt-16 border-t border-white/10 pt-8">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-[#dfbfbf]">{t("auth.trustedBy")}</p>
          <div className="flex items-center gap-8 text-[#c8c6c5]/70">
            <Building2 size={28} />
            <Building2 size={28} />
            <Building2 size={28} />
            <Building2 size={28} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={compact ? "flex h-9 w-9 items-center justify-center rounded-lg bg-[#b03040] text-[#ffd0d1]" : "flex h-10 w-10 items-center justify-center rounded-lg bg-[#b03040] text-[#ffd0d1]"}>
        {compact ? <Brain size={22} /> : <span className="font-bold">B</span>}
      </div>
      <span className={compact ? "text-2xl font-black uppercase tracking-tight text-white" : "text-xl font-bold uppercase tracking-wide text-white"}>
        {compact ? "Planix" : "Smart Business Assistant"}
      </span>
    </div>
  );
}

function MobileBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="mb-10 flex items-center justify-center gap-3 lg:hidden">
      <BrandMark compact={compact} />
    </div>
  );
}

function FeatureRow({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#192029] text-[#ffb3b5]">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-white">{title}</h3>
        <p className="text-sm leading-5 text-[#dfbfbf]">{text}</p>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-white/10 bg-[#2e353f]/40 p-4 backdrop-blur-xl">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-[#192029] text-[#b03040]">
        <Icon size={21} />
      </div>
      <div>
        <h3 className="mb-1 text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm leading-5 text-[#dfbfbf]">{text}</p>
      </div>
    </div>
  );
}

function AuthField({
  icon: Icon,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  rightLabel,
  trailingIcon: TrailingIcon,
  compact = false
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  rightLabel?: string;
  trailingIcon?: LucideIcon;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-semibold text-[#dce3f0]">
        <span className={compact ? "text-xs uppercase tracking-[0.05em] text-[#dfbfbf]" : ""}>{label}</span>
        {rightLabel ? <span className="text-xs font-semibold text-[#ffb3b5]">{rightLabel}</span> : null}
      </span>
      <span
        className={[
          "group flex items-center gap-3 border text-[#dfbfbf] transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-[#ffb3b5]",
          compact
            ? "rounded-md border-transparent border-b-[#584141]/60 bg-[#232a34] px-3 py-3"
            : "rounded-xl border-[#584141]/50 bg-[#192029]/65 px-3 py-3"
        ].join(" ")}
      >
        <Icon size={18} className="shrink-0 transition group-focus-within:text-[#ffb3b5]" />
        <input
          required
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#dce3f0] outline-none placeholder:text-[#dfbfbf]/45"
        />
        {TrailingIcon ? <TrailingIcon size={17} className="shrink-0 text-[#dfbfbf]" /> : null}
      </span>
    </label>
  );
}
