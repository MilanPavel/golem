import SwiftUI

extension View {
    /// Shows the card for `AppModel.presentedReview`.
    func reviewSheet(_ app: AppModel) -> some View {
        sheet(
            isPresented: Binding(
                get: { app.presentedReview != nil },
                set: { if !$0 { app.dismissReview() } })
        ) {
            if let review = app.presentedReview {
                ReviewCard(model: review, onClose: { app.dismissReview() })
                    .presentationDetents([.large])
            }
        }
    }
}
