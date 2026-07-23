import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { Card, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await register(name.trim(), email.trim(), password);
      router.replace("/(app)");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Kayıt başarısız. Lütfen tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen tone="auth" contentContainerStyle={styles.screen}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brand}>Planix</Text>
          <Text style={styles.brandSub}>Smart business assistant</Text>
        </View>
        <LanguageSwitcher />
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Mobil operasyon katmanınızı dakikalar içinde kurun.</Text>
        <Text style={styles.heroCopy}>Görevler, firmalar ve AI destekli analiz aynı merkezde birleşir.</Text>
      </View>

      <Card variant="dark">
        <Text style={styles.formTitle}>{t("auth.register")}</Text>
        <Text style={styles.formCopy}>Hesabınızı oluşturun.</Text>

        <TextField label={t("auth.name")} value={name} onChangeText={setName} placeholder="Ad Soyad" style={styles.darkInput} />
        <TextField
          label={t("auth.email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="name@company.com"
          style={styles.darkInput}
        />
        <TextField
          label={t("auth.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          placeholder="........"
          style={styles.darkInput}
          right={
            <Pressable
              onPress={() => setShowPassword((current) => !current)}
              style={styles.eyeButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
            >
              <Feather name={showPassword ? "eye-off" : "eye"} size={16} color={colors.muted} />
            </Pressable>
          }
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label={t("auth.createAccount")} onPress={() => void submit()} loading={submitting} />
        <Link href="/(auth)/login" style={styles.link}>
          {t("auth.login")}
        </Link>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 18
  },
  topBar: {
    gap: 14
  },
  brand: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.4
  },
  brandSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2
  },
  hero: {
    gap: 6
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 28,
    letterSpacing: -0.4
  },
  heroCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  formTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "600",
    letterSpacing: -0.3
  },
  formCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  darkInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    color: colors.text
  },
  eyeButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "500"
  },
  link: {
    color: colors.primary,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4
  }
});
