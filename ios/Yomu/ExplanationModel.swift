import Foundation

/// Which model writes the explanation. The server keeps its own allow-list, so a
/// value from here is checked rather than trusted.
enum ExplanationModel: String, CaseIterable, Identifiable {
    case luna = "gpt-5.6-luna"
    case terra = "gpt-5.6-terra"

    static let `default` = ExplanationModel.luna

    var id: String { rawValue }

    var title: String {
        switch self {
        case .luna: return "Luna"
        case .terra: return "Terra"
        }
    }

    /// Measured on a real page: roughly 0.035¢ against 0.32¢ for one lookup with
    /// the page in view.
    var detail: String {
        switch self {
        case .luna: return "Standard. About a thirtieth of a cent per lookup."
        case .terra: return "Phrasing reads a little more naturally, and replies slightly faster. Around nine times the cost."
        }
    }
}
