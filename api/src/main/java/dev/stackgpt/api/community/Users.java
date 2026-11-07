package dev.stackgpt.api.community;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * PoC anonymous identity: the extension generates a random token and sends it as X-StackGPT-Token.
 * Only its SHA-256 is stored (users.token), so a DB leak does not reveal usable tokens.
 */
@Component
public class Users {
	public static final String HEADER = "X-StackGPT-Token";
	static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{32,128}");

	private final JdbcTemplate jdbc;

	public Users(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	/** Existing user id for a token, or null (reads never create users). */
	public Long find(String token) {
		if (!valid(token)) return null;
		return jdbc.query("select id from users where token = ?", rs -> rs.next() ? rs.getLong(1) : null, hash(token));
	}

	/** User id for a token, creating the user on first write; 401 when the token is missing or malformed. */
	public long require(String token) {
		if (!valid(token)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or malformed " + HEADER);
		return jdbc.queryForObject("""
				insert into users (token) values (?)
				on conflict (token) do update set token = excluded.token returning id""", Long.class, hash(token));
	}

	static boolean valid(String token) {
		return token != null && TOKEN.matcher(token).matches();
	}

	static String hash(String token) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}
}
