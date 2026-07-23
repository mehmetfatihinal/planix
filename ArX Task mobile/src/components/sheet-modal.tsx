import type { PropsWithChildren, ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/components/ui";

export function SheetModal({
  visible,
  title,
  subtitle,
  onClose,
  footer,
  children
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
}>) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={styles.close}>
              <Feather name="x" size={18} color={colors.textSoft} />
            </Pressable>
          </View>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)"
  },
  card: {
    maxHeight: "84%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surfaceStrong,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 14
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  copy: {
    flex: 1,
    gap: 3
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.2
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt
  },
  body: {
    gap: 12
  },
  footer: {
    gap: 10
  }
});
