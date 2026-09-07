import { assert } from "chai";
import {
  beginRun,
  isStopped,
  requestStop,
  stopRequested,
  throwIfStopped,
} from "../src/utils/cancel";

/**
 * The stop a window asks for while a run is going.
 *
 * The flag outlives the run that set it on purpose -- a window reads it
 * afterwards to say whether what it is showing is the whole folder -- so the
 * case that matters most here is that starting a new run clears it. Without
 * that, a stop asked for at the very end of one run kills the next one before
 * it reads a single file.
 */
describe("the stop flag", function () {
  beforeEach(function () {
    beginRun();
  });

  it("is not set until it is asked for", function () {
    assert.isFalse(stopRequested());
  });

  it("is set once asked for, and stays set after the run ends", function () {
    requestStop();
    assert.isTrue(stopRequested());
    // The window reads it after the await returns to caption the result.
    assert.isTrue(stopRequested());
  });

  it("is cleared by the next run, not by reading it", function () {
    requestStop();
    assert.isTrue(stopRequested());
    beginRun();
    assert.isFalse(stopRequested());
  });

  it("takes a second request without complaint", function () {
    requestStop();
    requestStop();
    assert.isTrue(stopRequested());
  });

  describe("throwIfStopped", function () {
    it("does nothing while no stop has been asked for", function () {
      assert.doesNotThrow(() => throwIfStopped());
    });

    it("throws the marked error once one has", function () {
      requestStop();
      assert.throws(() => throwIfStopped(), "stopped");
      try {
        throwIfStopped();
        assert.fail("should have thrown");
      } catch (e) {
        assert.isTrue(isStopped(e));
      }
    });
  });

  describe("isStopped", function () {
    it("recognises the stop across the window boundary", function () {
      // The window checks e.name rather than instanceof: the error is thrown
      // in the plugin's scope and caught in the window's, where instanceof
      // against the plugin's class is false.
      assert.isTrue(isStopped({ name: "Stopped" }));
    });

    it("does not swallow an ordinary failure", function () {
      assert.isFalse(isStopped(new Error("disk full")));
      assert.isFalse(isStopped(null));
      assert.isFalse(isStopped(undefined));
      assert.isFalse(isStopped("stopped"));
    });
  });
});
