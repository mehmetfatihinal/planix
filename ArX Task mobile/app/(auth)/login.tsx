import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { Card, PrimaryButton, Screen, TextField, colors } from "@/components/ui";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
      router.replace("/(app)");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Giriş başarısız. Bilgileri kontrol edin.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen tone="auth" contentContainerStyle={styles.screen}>
      <View style={styles.topBar}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>Planix</Text>
          <Text style={styles.brandSub}>Smart business assistant</Text>
        </View>
        <LanguageSwitcher />
      </View>

      <Card variant="dark" style={styles.formCard}>
        <Text style={styles.formTitle}>{t("auth.login")}</Text>
        <Text style={styles.formCopy}>Mobil çalışma alanınıza bağlanın.</Text>

        <TextField
          label={t("auth.emailOrUsername")}
          value={email}
          onChangeText={setEmail}
          keyboardType="default"
          autoCapitalize="none"
          placeholder="name@company.com / admin"
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
        <PrimaryButton label={t("auth.login")} onPress={() => void submit()} loading={submitting} />
        <Link href="/(auth)/register" style={styles.link}>
          {t("auth.createAccount")}
        </Link>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: "center",
    gap: 16
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  brandBlock: {
    flex: 1,
    gap: 4
  },
  brand: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: -0.4
  },
  brandSub: {
    color: colors.muted,
    fontSize: 12
  },
  formCard: {
    paddingTop: 18,
    gap: 12
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
