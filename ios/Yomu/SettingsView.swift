import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var backend: Backend
    @Environment(\.dismiss) private var dismiss
    @AppStorage("yomu.level") private var level: String = "N2"
    @AppStorage("yomu.model") private var model: String = ExplanationModel.default.rawValue
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
                    Picker("Model", selection: $model) {
                        ForEach(ExplanationModel.allCases) { option in
                            Text(option.title).tag(option.rawValue)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Explanation model")
                } footer: {
                    Text(ExplanationModel(rawValue: model)?.detail ?? "")
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
