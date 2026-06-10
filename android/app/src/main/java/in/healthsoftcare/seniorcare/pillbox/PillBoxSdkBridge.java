package in.healthsoftcare.seniorcare.pillbox;

import com.xm.xjh.blelibrary.opera.PillBox;
import com.xm.xjh.blelibrary.opera.PillBoxControlManager;

public final class PillBoxSdkBridge {
  private PillBoxSdkBridge() {}

  public static PillBox pillBox() {
    return PillBox.INSTANCE;
  }

  public static PillBoxControlManager controlManager() {
    return PillBoxControlManager.INSTANCE;
  }
}
