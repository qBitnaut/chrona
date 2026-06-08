import { createRoot } from "react-dom/client";
import App from "./components/App.jsx";
import "./styles.css";

// No StrictMode: the widget owns native-window side effects (resize, event
// listeners) that we don't want double-invoked.
createRoot(document.getElementById("root")).render(<App />);
