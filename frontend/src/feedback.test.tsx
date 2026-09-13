// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FeedbackProvider, useFeedback } from "./feedback";

function Harness() {
  const { notify, confirm } = useFeedback(); const [answer, setAnswer] = useState("waiting");
  return <><button onClick={() => notify("Saved safely", "success")}>Notify</button><button onClick={async () => setAnswer(await confirm({ title: "Land aircraft", message: "Confirm landing", danger: true }) ? "yes" : "no")}>Confirm</button><output>{answer}</output></>;
}

afterEach(cleanup);
describe("shared feedback", () => {
  it("renders toast notifications", async () => { render(<FeedbackProvider><Harness /></FeedbackProvider>); await userEvent.click(screen.getByText("Notify")); expect(screen.getByText("Saved safely")).toBeTruthy(); });
  it("resolves confirmation dialogs", async () => { render(<FeedbackProvider><Harness /></FeedbackProvider>); await userEvent.click(screen.getByText("Confirm")); const dialog = screen.getByRole("dialog"); expect(dialog).toBeTruthy(); await userEvent.click(within(dialog).getByRole("button", { name: "Confirm" })); expect(screen.getByText("yes")).toBeTruthy(); });
  it("dismisses a confirmation with Escape", async () => { render(<FeedbackProvider><Harness /></FeedbackProvider>); await userEvent.click(screen.getByText("Confirm")); await userEvent.keyboard("{Escape}"); expect(screen.getByText("no")).toBeTruthy(); expect(screen.queryByRole("dialog")).toBeNull(); });
  it("labels and dismisses toast notifications", async () => { render(<FeedbackProvider><Harness /></FeedbackProvider>); await userEvent.click(screen.getByText("Notify")); const toast = screen.getByText("Saved safely").closest(".toast"); expect(toast).toBeTruthy(); await userEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Dismiss notification" })); expect(screen.queryByText("Saved safely")).toBeNull(); });
  it("shows critical alerts sent through the global bridge", async () => { render(<FeedbackProvider><Harness /></FeedbackProvider>); window.dispatchEvent(new CustomEvent("drone:critical-alert", { detail: { message: "GPS signal lost" } })); expect(await screen.findByText("Critical alert: GPS signal lost")).toBeTruthy(); });
});
