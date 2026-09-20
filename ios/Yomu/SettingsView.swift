import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var backend: Backend
    @Environment(\.dismiss) private var dismiss
    @AppStorage("yomu.level") private var level: String = "N2"
    @State private var origin: String = ""

    private let levels = [
        ("N5", "Beginner"), ("N4", "Elementary"), ("N3", "Intermediate"),
        ("N2", "Advanced"), ("N1", "Proficient"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Explanation level") {
                    Picker("Level", selection: $level) {
                        ForEach(levels, id: \.0) { code, name in
                            Text("\(code) · \(name)").tag(code)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

                Section {
                    TextField("https://…", text: $origin)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit(saveOrigin)
                } header: {
                    Text("Server")
                } footer: {
                    Text("Where explanations come from. Reading the page and looking up words happen on this device.")
                }
            }
            .navigationTitle("Preferences")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { saveOrigin(); dismiss() }
                }
            }
        }
        .onAppear { origin = backend.origin }
    }

    private func saveOrigin() {
        let trimmed = origin.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty, trimmed != backend.origin else { return }
        backend.origin = trimmed
    }
}
