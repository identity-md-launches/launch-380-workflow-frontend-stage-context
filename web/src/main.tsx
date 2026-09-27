import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { loadRuntime } from "./config";
import { errorText } from "./domain";
import "./style.css";
const root = ReactDOM.createRoot(document.getElementById("root")!);
loadRuntime()
  .then((runtime) =>
    root.render(
      <WagmiProvider config={runtime.wagmi}>
        <QueryClientProvider client={new QueryClient()}>
          <App runtime={runtime} />
        </QueryClientProvider>
      </WagmiProvider>,
    ),
  )
  .catch((error) =>
    root.render(
      <main className="wrap startup-error">
        <h1>Threeway is unavailable.</h1>
        <p role="alert">{errorText(error)}</p>
        <button onClick={() => window.location.reload()}>Retry loading</button>
        <p>
          No transaction controls are available until deployment integrity is
          verified.
        </p>
      </main>,
    ),
  );
