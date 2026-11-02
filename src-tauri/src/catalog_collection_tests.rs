fn collection_song(id: &str, title: &str, language: &str, genre: &str) -> Value {
    serde_json::json!({
        "id": id,
        "type": "song",
        "title": title,
        "language": language,
        "image": "https://c.saavncdn.com/517/album-150x150.jpg",
        "more_info": {
            "duration": "180",
            "album": "Collection album",
            "genre": genre,
            "artistMap": { "primary_artists": [{ "id": "42", "name": "Artist" }] }
        }
    })
}

fn test_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

fn search_response(rows: Vec<Value>) -> String {
    serde_json::json!({ "results": rows }).to_string()
}

#[test]
fn mood_collection_uses_genre_metadata_and_queries_each_selected_language() {
    let valid_english = collection_song(
        "abcdefgh",
        "A track with no mood word in title",
        "english",
        "Pop",
    );
    let wrong_genre = collection_song("ijklmnop", "Upbeat unrelated", "english", "Classical");
    let valid_hindi = collection_song("qrstuvwx", "Another title", "hindi", "Dance");
    let (base, server) = crate::provider_http::tests::server(vec![
        (
            "200 OK",
            search_response(vec![valid_english.clone(), wrong_genre]),
        ),
        ("200 OK", search_response(vec![valid_hindi.clone()])),
        ("200 OK", search_response(vec![])),
        ("200 OK", search_response(vec![valid_hindi])),
    ]);
    let tracks = test_runtime()
        .block_on(search_mood_tracks(
            &base,
            "Feel good",
            &["english".into(), "hindi".into()],
        ))
        .unwrap();
    let ids: std::collections::HashSet<_> = tracks.iter().map(|track| track.id.as_str()).collect();
    assert_eq!(
        ids,
        ["saavn:abcdefgh", "saavn:qrstuvwx"].into_iter().collect()
    );
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 4);
    assert!(requests.iter().any(
        |request| request.contains("q=happy+english") || request.contains("q=happy%20english")
    ));
    assert!(requests
        .iter()
        .any(|request| request.contains("q=happy+hindi") || request.contains("q=happy%20hindi")));
}

#[test]
fn romance_mood_keeps_live_shaped_results_without_genre_metadata() {
    let pop_track = collection_song("romanc01", "Love song", "hindi", "");
    let soul_track = collection_song("romanc02", "Romantic ballad", "hindi", "");
    let mut provider_pop = pop_track.clone();
    provider_pop["more_info"]["genre"] = Value::Null;
    provider_pop["more_info"]["primary_genre_name"] = serde_json::json!("Pop");
    let mut provider_soul = soul_track.clone();
    provider_soul["more_info"]["genre"] = Value::Null;
    provider_soul["more_info"]["primary_genre_name"] = serde_json::json!("Soul");
    let (base, server) = crate::provider_http::tests::server(vec![(
        "200 OK",
        search_response(vec![provider_pop, provider_soul]),
    )]);

    let tracks = test_runtime()
        .block_on(search_mood_tracks(&base, "Romance", &["hindi".into()]))
        .unwrap();
    let ids: std::collections::HashSet<_> = tracks.iter().map(|track| track.id.as_str()).collect();
    assert_eq!(
        ids,
        ["saavn:romanc01", "saavn:romanc02"].into_iter().collect()
    );
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("q=romantic+hindi") || requests[0].contains("q=romantic%20hindi"));
}

#[test]
fn genre_collection_rejects_title_matches_without_matching_genre_metadata() {
    let title_only = collection_song("abcdefgh", "Jazz in the title", "english", "Pop");
    let genre_match = collection_song("ijklmnop", "Song without matching title", "english", "Jazz");
    let wrong_language = collection_song("qrstuvwx", "Jazz title", "tamil", "Jazz");
    let (base, server) = crate::provider_http::tests::server(vec![(
        "200 OK",
        search_response(vec![title_only, genre_match, wrong_language]),
    )]);
    let details = test_runtime()
        .block_on(search_genre_collection_from(
            &base,
            "Jazz",
            &["english".into()],
        ))
        .unwrap();
    assert_eq!(
        details
            .tracks
            .iter()
            .map(|track| track.id.as_str())
            .collect::<Vec<_>>(),
        ["saavn:ijklmnop"]
    );
    assert_eq!(server.join().unwrap().len(), 1);
}
