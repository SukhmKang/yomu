import SwiftUI

/// Every dictionary entry a word matched, ranked, with all its senses — what
/// Yomitan shows on hover. The panel summarises only the first, and Yomitan's
/// ranking puts the wrong one first often enough that the rest must be reachable.
struct WordDetailView: View {
    let entry: VocabularyEntry
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(entry.candidates.enumerated()), id: \.element.id) { index, candidate in
                    Section {
                        ForEach(Array(candidate.senses.enumerated()), id: \.offset) { number, sense in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("\(number + 1)")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.tertiary)
                                Text(sense).font(.callout)
                            }
                        }
                    } header: {
                        header(candidate, isBest: index == 0)
                    }
                }
            }
            .navigationTitle(entry.surface)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func header(_ candidate: DictionaryCandidate, isBest: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(candidate.word)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                if candidate.reading != candidate.word {
                    Text(candidate.reading).font(.subheadline).foregroundStyle(.secondary)
                }
                if isBest {
                    Text("shown").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            HStack(spacing: 10) {
                if let via = candidate.viaForm {
                    Text("\(entry.surface) → \(via)")
                }
                if !candidate.partOfSpeech.isEmpty {
                    Text(candidate.partOfSpeech)
                }
                if let frequency = candidate.frequency {
                    Text("JPDB #\(frequency)")
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .textCase(nil)
    }
}
