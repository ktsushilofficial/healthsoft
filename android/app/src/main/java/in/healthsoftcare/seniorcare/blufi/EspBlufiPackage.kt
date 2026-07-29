package `in`.healthsoftcare.seniorcare.blufi

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class EspBlufiPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): MutableList<NativeModule> = mutableListOf(EspBlufiModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): MutableList<ViewManager<*, *>> = mutableListOf()
}
