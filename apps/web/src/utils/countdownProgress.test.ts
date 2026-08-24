import { describe, expect, it } from "vitest";
import { countdownProgress, URGENT_THRESHOLD_SEC } from "./countdownProgress";

describe("countdownProgress", () => {
  it("returns full progress at the start of the countdown", () => {
    expect(countdownProgress(30, 30)).toMatchObject({ progress: 1 });
  });

  it("returns zero progress once time is up", () => {
    expect(countdownProgress(0, 30)).toMatchObject({ progress: 0 });
  });

  it("clamps progress to 0 when secondsLeft has gone negative", () => {
    expect(countdownProgress(-5, 30)).toMatchObject({ progress: 0 });
  });

  it("clamps progress to 1 when secondsLeft exceeds the total", () => {
    expect(countdownProgress(45, 30)).toMatchObject({ progress: 1 });
  });

  it("avoids dividing by zero when totalSeconds is 0", () => {
    expect(countdownProgress(0, 0)).toMatchObject({ progress: 0 });
  });

  it(`is urgent at exactly the ${URGENT_THRESHOLD_SEC}s threshold and below`, () => {
    expect(countdownProgress(URGENT_THRESHOLD_SEC, 30)).toMatchObject({ urgent: true });
    expect(countdownProgress(URGENT_THRESHOLD_SEC - 1, 30)).toMatchObject({ urgent: true });
    expect(countdownProgress(0, 30)).toMatchObject({ urgent: true });
  });

  it(`is not urgent above the ${URGENT_THRESHOLD_SEC}s threshold`, () => {
    expect(countdownProgress(URGENT_THRESHOLD_SEC + 1, 30)).toMatchObject({ urgent: false });
    expect(countdownProgress(30, 30)).toMatchObject({ urgent: false });
  });
});
