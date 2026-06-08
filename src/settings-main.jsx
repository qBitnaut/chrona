import { createRoot } from "react-dom/client";
import Settings from "./components/Settings.jsx";
import "./settings.css";

// no WebView2 default context menu in the settings window
document.addEventListener("contextmenu", (e) => e.preventDefault(), true);

createRoot(document.getElementById("root")).render(<Settings />);
