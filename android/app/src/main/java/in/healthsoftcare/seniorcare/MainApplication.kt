package `in`.healthsoftcare.seniorcare

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import `in`.healthsoftcare.seniorcare.v8.V8BlePackage
import `in`.healthsoftcare.seniorcare.pillbox.PillBoxPackage
import `in`.healthsoftcare.seniorcare.pillbox.PillBoxSdkBridge

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(V8BlePackage())
          add(PillBoxPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    PillBoxSdkBridge.pillBox().initPillBox(this, BuildConfig.DEBUG)
    loadReactNative(this)
  }
}
