allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// stripe_android 14.2.0 adds Stripe's card-issuing push provisioning (unused by TowNow) as
// compileOnly but without transitive=false, so Gradle looks for play-services-tapandpay,
// which no public repository publishes. The plugin only touches it via reflection.
subprojects {
    configurations.configureEach {
        exclude(group = "com.google.android.gms", module = "play-services-tapandpay")
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
