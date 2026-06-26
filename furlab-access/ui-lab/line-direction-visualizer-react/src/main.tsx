import ReactDOM from "react-dom/client";
import { AppWithProviders } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <AppWithProviders />
);

