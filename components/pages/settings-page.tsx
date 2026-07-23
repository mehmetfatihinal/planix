"use client";

import { useEffect, useState } from "react";
import { Bell, Building2, Check, Home, MapPin, Save } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui/ui-kit";

const REMINDER_PRESETS = [15, 30, 60, 120];

export function SettingsPage() {
  const { t, settings, updateSettings } = useAppState();
  const [reminderLead, setReminderLead] = useState("30");
  const [dailyDigest, setDailyDigest] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [homeAddress, setHomeAddress] = useState("");
  const [homeLatitude, setHomeLatitude] = useState<number | null>(null);
  const [homeLongitude, setHomeLongitude] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyTaxId, setCompanyTaxId] = useState("");
  const [companyIban, setCompanyIban] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!settings) return;
    setReminderLead(String(settings.defaultReminderLeadMinutes ?? 30));
    setDailyDigest(settings.dailyDigestEnabled);
    setWeeklyDigest(settings.weeklyDigestEnabled);
    setHomeAddress(settings.homeAddress ?? "");
    setHomeLatitude(settings.homeLatitude ?? null);
    setHomeLongitude(settings.homeLongitude ?? null);
    setCompanyName(settings.companyName ?? "");
    setCompanyAddress(settings.companyAddress ?? "");
    setCompanyPhone(settings.companyPhone ?? "");
    setCompanyEmail(settings.companyEmail ?? "");
    setCompanyTaxId(settings.companyTaxId ?? "");
    setCompanyIban(settings.companyIban ?? "");
    setPaymentTerms(settings.paymentTerms ?? "");
  }, [settings]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const homeSaved = homeLatitude !== null && homeLongitude !== null;

  function captureCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setErrorMessage(t("settings.locationError"));
      return;
    }
    setLocating(true);
    setErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setHomeLatitude(position.coords.latitude);
        setHomeLongitude(position.coords.longitude);
        setLocating(false);
      },
      () => {
        setErrorMessage(t("settings.locationError"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  async function save() {
    setSaving(true);
    setErrorMessage(null);
    try {
      const parsedLead = Number.parseInt(reminderLead, 10);
      await updateSettings({
        defaultReminderLeadMinutes: Number.isFinite(parsedLead) ? parsedLead : null,
        dailyDigestEnabled: dailyDigest,
        weeklyDigestEnabled: weeklyDigest,
        homeAddress: homeAddress.trim() || null,
        homeLatitude,
        homeLongitude,
        companyName: companyName.trim() || null,
        companyAddress: companyAddress.trim() || null,
        companyPhone: companyPhone.trim() || null,
        companyEmail: companyEmail.trim() || null,
        companyTaxId: companyTaxId.trim() || null,
        companyIban: companyIban.trim() || null,
        paymentTerms: paymentTerms.trim() || null
      });
      setSavedAt(Date.now());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        action={
          <Button onClick={() => void save()} disabled={saving}>
            <Save size={16} />
            {saving ? t("settings.saving") : t("actions.save")}
          </Button>
        }
      />
      {savedAt ? (
        <div className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm text-success dark:text-[#80D9B0]">
          {t("settings.saved")}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-danger/25 bg-danger/10 p-4 text-sm text-danger dark:text-[#FCA5A5]">
          {errorMessage}
        </div>
      ) : null}

      <Card>
        <SectionTitle title={t("settings.notifications")} icon={Bell} />
        <label className="block max-w-md">
          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("settings.reminderLead")}</span>
          <input
            type="number"
            min={0}
            value={reminderLead}
            onChange={(event) => setReminderLead(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {REMINDER_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => setReminderLead(String(minutes))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                reminderLead === String(minutes)
                  ? "border-primary bg-primary text-white dark:border-darkPrimary dark:bg-darkPrimary"
                  : "border-[#E5D8C7] bg-white text-muted hover:border-primary/35 hover:text-primary dark:border-darkBorder dark:bg-[#242424] dark:text-darkMuted"
              )}
            >
              {minutes} {t("settings.minutesShort")}
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ToggleRow label={t("settings.dailyDigest")} checked={dailyDigest} onChange={setDailyDigest} />
          <ToggleRow label={t("settings.weeklyDigest")} checked={weeklyDigest} onChange={setWeeklyDigest} />
        </div>
      </Card>

      <Card>
        <SectionTitle title={t("settings.homeLocation")} icon={Home} />
        <label className="block">
          <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{t("settings.homeAddress")}</span>
          <input
            value={homeAddress}
            onChange={(event) => setHomeAddress(event.target.value)}
            className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={captureCurrentLocation} disabled={locating}>
            <MapPin size={16} />
            {locating ? t("settings.locating") : t("settings.useCurrentLocation")}
          </Button>
          {homeSaved ? (
            <Badge tone="success">
              <Check size={13} className="me-1" />
              {t("settings.homeSaved")} · {homeLatitude?.toFixed(5)}, {homeLongitude?.toFixed(5)}
            </Badge>
          ) : (
            <Badge tone="warning">{t("settings.homeNotSaved")}</Badge>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle title={t("settings.companyProfile")} subtitle={t("settings.companyProfileHint")} icon={Building2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsInput label={t("settings.companyName")} value={companyName} onChange={setCompanyName} />
          <SettingsInput label={t("company.phone")} value={companyPhone} onChange={setCompanyPhone} />
          <div className="sm:col-span-2">
            <SettingsInput label={t("company.address")} value={companyAddress} onChange={setCompanyAddress} />
          </div>
          <SettingsInput label={t("company.email")} value={companyEmail} onChange={setCompanyEmail} />
          <SettingsInput label={t("settings.taxId")} value={companyTaxId} onChange={setCompanyTaxId} />
          <SettingsInput label={t("settings.iban")} value={companyIban} onChange={setCompanyIban} />
          <SettingsInput label={t("offers.paymentTerms")} value={paymentTerms} onChange={setPaymentTerms} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            <Save size={16} />
            {saving ? t("settings.saving") : t("actions.save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SettingsInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-text dark:text-[#F5F0EA]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 w-full rounded-xl border border-[#E5D8C7] bg-white px-3 text-sm outline-none focus:border-primary/40 dark:border-darkBorder dark:bg-[#242424]"
      />
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-xl border border-[#E5D8C7] bg-white px-3 py-2.5 text-sm font-medium text-text transition hover:border-primary/35 dark:border-darkBorder dark:bg-[#242424] dark:text-[#F5F0EA]"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
          checked ? "bg-primary dark:bg-darkPrimary" : "bg-[#E5D8C7] dark:bg-[#3A3A3A]"
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}
