import { TradingApp } from "./components/trading-app";
import { LoginGate } from "./components/login-gate";

export default function Home() {
  return <LoginGate><TradingApp /></LoginGate>;
}
