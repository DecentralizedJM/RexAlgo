import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type MudrexKeyInvalidContextValue = {
  mudrexKeyInvalid: boolean;
  setMudrexKeyInvalid: (value: boolean) => void;
};

const MudrexKeyInvalidContext = createContext<MudrexKeyInvalidContextValue | null>(null);

export function MudrexKeyInvalidProvider({ children }: { children: ReactNode }) {
  const [mudrexKeyInvalid, setMudrexKeyInvalid] = useState(false);
  const value = useMemo(
    () => ({ mudrexKeyInvalid, setMudrexKeyInvalid }),
    [mudrexKeyInvalid]
  );
  return (
    <MudrexKeyInvalidContext.Provider value={value}>
      {children}
    </MudrexKeyInvalidContext.Provider>
  );
}

export function useMudrexKeyInvalid(): MudrexKeyInvalidContextValue {
  const ctx = useContext(MudrexKeyInvalidContext);
  if (!ctx) {
    throw new Error("useMudrexKeyInvalid must be used within MudrexKeyInvalidProvider");
  }
  return ctx;
}
