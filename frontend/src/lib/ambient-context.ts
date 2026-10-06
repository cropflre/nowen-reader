import { createContext, useContext } from "react";
import type { ShelfFocus } from "@/components/home/dashboard-shelf";

export const AmbientFocusContext = createContext<(focus: ShelfFocus) => void>(() => {});
export const useAmbientFocus = () => useContext(AmbientFocusContext);
