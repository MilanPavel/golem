import GolemKit
import SwiftUI

/// Says why the app cannot reach the Mac and what happens to answers meanwhile. It sits above every tab
/// and goes away when the link is back.
struct ConnectionBanner: View {
    let model: AppModel

    var body: some View {
        if let banner = model.banner {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(banner.title).font(.subheadline.bold())
                    Text(banner.detail).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.15))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("connection.banner")
        }
    }
}
