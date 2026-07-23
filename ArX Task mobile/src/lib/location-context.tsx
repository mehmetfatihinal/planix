import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  defaultLocationState,
  getCurrentUserLocation,
  getLocationPermissionState,
  requestLocationPermissionState
} from "@/lib/location";
import type { UserLocationState } from "@/types/business";

type LocationContextValue = {
  state: UserLocationState;
  refreshLocation: () => Promise<void>;
  requestPermission: () => Promise<void>;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UserLocationState>(defaultLocationState);

  const refreshLocation = async () => {
    try {
      const coords = await getCurrentUserLocation();
      setState((current) => ({
        ...current,
        coords,
        updatedAt: new Date().toISOString(),
        error: null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Konum alinamadi."
      }));
    }
  };

  const requestPermission = async () => {
    const permissionState = await requestLocationPermissionState();
    setState((current) => ({
      ...current,
      ...permissionState,
      error: permissionState.granted ? current.error : "Konum izni verilmedi."
    }));

    if (permissionState.granted) {
      await refreshLocation();
    }
  };

  useEffect(() => {
    getLocationPermissionState()
      .then(async (permissionState) => {
        setState((current) => ({ ...current, ...permissionState }));
        if (permissionState.granted) {
          await refreshLocation();
        }
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<LocationContextValue>(
    () => ({
      state,
      refreshLocation,
      requestPermission
    }),
    [state]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useUserLocation() {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error("useUserLocation must be used within LocationProvider");
  }

  return context;
}
